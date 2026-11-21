import { collectDelta, isOwnRecord } from "../core/delta.js";
import { parseAdviceFrame } from "../core/frame.js";
import { limitText } from "../core/limits.js";
import { markReviewed } from "../core/scope.js";
import { modelRef } from "../core/config.js";
import { createEmissionGuard } from "../core/guard.js";
import { formatNote } from "../core/next-block.js";
import { buildReviewPrompt, REVIEWER_SYSTEM } from "./prompts.js";

const DELTA_MAX = 16_000;
const NOTE_KEY = "advisor-note";
export const NO_ADVICE = "NO_ADVICE";

function messageText(message) {
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }
  return typeof message?.text === "string" ? message.text : "";
}

function toDeltaMessage(message) {
  return {
    id: message?.id,
    role: message?.type ?? message?.role ?? "user",
    text: messageText(message),
    description: message?.description,
  };
}

/** True when the last human input is older than the last advisor insert. */
function triggeredByAdvisor(messages) {
  let userAt = -1;
  let advisorAt = -1;
  messages.forEach((message, index) => {
    if (isOwnRecord(message)) advisorAt = index;
    else if (message.role === "user") userAt = index;
  });
  return advisorAt > -1 && advisorAt > userAt;
}

function transcriptOf(messages) {
  return messages
    .map((message) => `${message.role}: ${message.text}`)
    .join("\n\n");
}

/**
 * One reviewer call for one finished step: reads the transcript delta, asks the
 * model for a graded note, and delivers it into the agent's context. Never
 * throws: every failure is a result the caller can count.
 */
export async function runReview({
  ctx,
  config,
  sessionID,
  state,
  display = "card",
  now = Date.now(),
}) {
  const model = modelRef(config);
  if (!model) return { kind: "skipped", reason: "model-missing" };
  if (state.inFlight) return { kind: "skipped", reason: "busy" };

  state.inFlight = true;
  const started = Date.now();
  try {
    let rawMessages;
    try {
      rawMessages = await ctx.session.context({ sessionID });
    } catch {
      return { kind: "dropped", reason: "error", ms: Date.now() - started };
    }

    const messages = (Array.isArray(rawMessages) ? rawMessages : []).map(
      toDeltaMessage,
    );

    // A step woken by our own steer answers the advice, not the person: review
    // it and the reviewer starts commenting on its own notes.
    if (triggeredByAdvisor(messages))
      return { kind: "skipped", reason: "advisor-triggered" };
    const delta = collectDelta(
      messages,
      state.lastSeenID,
      config.maxDeltaMessages,
    );
    state.lastSeenID = delta.lastSeenID;
    if (delta.messages.length === 0)
      return { kind: "skipped", reason: "no-delta" };

    // A tool-only step has no text to review; calling the model would only
    // produce "your answer is empty" advice about work that did happen.
    const hasText = delta.messages.some(
      (message) =>
        typeof message.text === "string" && message.text.trim() !== "",
    );
    if (!hasText) return { kind: "skipped", reason: "no-text" };

    const transcript = limitText(transcriptOf(delta.messages), DELTA_MAX);
    const prompt = `${REVIEWER_SYSTEM}\n\n${buildReviewPrompt(transcript)}`;

    let text;
    try {
      // OpenCode's stateless generator takes a Model.Ref: providerID + id.
      const answer = await ctx.experimental.generate.text({
        model: { providerID: model.providerID, id: model.modelID },
        prompt,
      });
      text = typeof answer?.text === "string" ? answer.text.trim() : "";
    } catch {
      return { kind: "dropped", reason: "error", ms: Date.now() - started };
    }

    const ms = Date.now() - started;

    // The user may switch the reviewer off while the model is thinking.
    if (state.disabled || !config.enabled)
      return { kind: "skipped", reason: "disabled", ms };
    if (text === "" || text === NO_ADVICE)
      return { kind: "dropped", reason: "empty", ms };

    let frame = parseAdviceFrame(text);
    if (!frame && config.proseFallback)
      frame = { severity: "nit", guidance: text };
    if (!frame) return { kind: "dropped", reason: "unparsed", ms };

    const note = limitText(frame.guidance, config.noteMaxChars);
    if (note === "") return { kind: "dropped", reason: "empty", ms };

    // The same advice never reaches the agent twice; an escalation still does.
    const guard = (state.guard ??= createEmissionGuard());
    if (!guard.accept({ severity: frame.severity, note }))
      return { kind: "skipped", reason: "duplicate", ms };

    const delivered = formatNote(frame.severity, note, display);
    try {
      if (frame.severity !== "nit") {
        await ctx.session.synthetic({
          sessionID,
          text: delivered,
          description: `advisor:${frame.severity}`,
          delivery: "steer",
        });
      }
      await ctx.session.instructions?.entry?.put({
        sessionID,
        key: NOTE_KEY,
        value: delivered,
      });
    } catch {
      return { kind: "dropped", reason: "error", ms };
    }

    if (frame.severity !== "nit") markReviewed(state, now, config.immuneTurns);

    return { kind: "delivered", severity: frame.severity, note, ms };
  } finally {
    state.inFlight = false;
  }
}
