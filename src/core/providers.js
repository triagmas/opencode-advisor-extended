/**
 * Snapshot of the models this OpenCode server can call, written by the plugin
 * for the panel's model picker. Only chat models of providers with at least one
 * model survive: a provider the user connected but kept empty is no choice.
 */
export function buildProvidersSnapshot(models, providers, now = Date.now()) {
  const byId = new Map();

  const ensure = (id) => {
    let provider = byId.get(id);
    if (!provider) {
      provider = { id, name: id, models: [] };
      byId.set(id, provider);
    }
    return provider;
  };

  for (const provider of Array.isArray(providers) ? providers : []) {
    if (!provider?.id) continue;
    const target = ensure(provider.id);
    if (typeof provider.name === "string" && provider.name !== "")
      target.name = provider.name;
  }

  for (const model of Array.isArray(models) ? models : []) {
    const modelID = model?.modelID ?? model?.id;
    const providerID = model?.providerID;
    if (!modelID || !providerID) continue;
    if (model?.type && model.type !== "chat") continue;
    const provider = ensure(providerID);
    if (provider.models.some((item) => item.id === modelID)) continue;
    provider.models.push({ id: modelID, name: model?.name || modelID });
  }

  const list = [...byId.values()]
    .filter((provider) => provider.models.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  for (const provider of list) {
    provider.models.sort((left, right) =>
      left.name.localeCompare(right.name, "ru"),
    );
  }

  return { at: now, providers: list };
}
