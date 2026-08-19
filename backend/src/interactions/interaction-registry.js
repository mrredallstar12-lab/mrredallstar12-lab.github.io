const COMMANDS = new Map([
  ["archive.record.review", command([], ["browser_session", "server_internal"])],
  ["archive.case.investigation.start", command([], ["browser_session", "server_internal"])],
  ["archive.case.evidence.pin", command([
    ["targetType", { type: "enum", values: ["record", "relationship", "inventory_definition", "inventory_instance"] }],
    ["catalogId", { type: "string", maxLength: 128 }]
  ], ["browser_session", "server_internal"])],
  ["archive.case.evidence.unpin", command([
    ["publicRef", { type: "string", maxLength: 128 }]
  ], ["browser_session", "server_internal"])],
  ["archive.case.step.attempt", command([
    ["answer", { type: "string", maxLength: 256 }]
  ], ["browser_session", "server_internal"])]
]);

function command(fields, sources) {
  return {
    fields: new Map(fields),
    sources: new Set(sources),
    environments: new Set(["development", "staging", "test", "production"])
  };
}

export function interactionDefinition(commandType) {
  return COMMANDS.get(commandType) || null;
}

export function validateInteractionCommand({ commandType, sourceType, environment, input = {} }) {
  const definition = interactionDefinition(commandType);
  if (!definition) return failure("interaction_command_unknown");
  if (!definition.sources.has(sourceType)) return failure("interaction_source_forbidden");
  if (!definition.environments.has(environment)) return failure("interaction_environment_forbidden");
  if (!input || typeof input !== "object" || Array.isArray(input)) return failure("interaction_input_invalid");
  if (Object.keys(input).length !== definition.fields.size) return failure("interaction_input_invalid");
  const canonical = {};
  for (const [field, rule] of definition.fields) {
    if (!(field in input)) return failure("interaction_input_invalid");
    const value = input[field];
    if (rule.type === "string") {
      if (typeof value !== "string" || value.length < 1 || value.length > rule.maxLength) return failure("interaction_input_invalid");
      canonical[field] = value;
    } else if (rule.type === "enum") {
      if (!rule.values.includes(value)) return failure("interaction_input_invalid");
      canonical[field] = value;
    }
  }
  return { ok: true, definition, input: canonical };
}

function failure(code) {
  return { ok: false, code };
}
