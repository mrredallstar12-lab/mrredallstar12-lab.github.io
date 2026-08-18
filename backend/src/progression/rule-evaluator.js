const BOOLEAN_KEYS = new Set(["all", "any", "not"]);
const LEAF_KEYS = new Set([
  "discovery",
  "inventory_quantity",
  "inventory_instance",
  "fictional_clearance",
  "prior_event_count",
  "relationship_discovered",
  "archive_state",
  "event_payload"
]);
const COMPARISONS = new Set(["eq", "gte", "lte", "gt", "lt"]);
const MAX_DEPTH = 8;
const MAX_NODES = 64;
const MAX_CHILDREN = 32;

export function validateCondition(condition) {
  const state = { nodes: 0, errors: [] };
  validateNode(condition, 1, state);
  return { ok: state.errors.length === 0, errors: state.errors };
}

function validateNode(node, depth, state) {
  state.nodes += 1;
  if (state.nodes > MAX_NODES) return state.errors.push("condition_node_limit_exceeded");
  if (depth > MAX_DEPTH) return state.errors.push("condition_depth_limit_exceeded");
  if (!node || typeof node !== "object" || Array.isArray(node)) return state.errors.push("condition_node_invalid");
  const keys = Object.keys(node);
  if (keys.length !== 1) return state.errors.push("condition_node_must_have_one_operator");
  const key = keys[0];
  const value = node[key];

  if (key === "all" || key === "any") {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CHILDREN) return state.errors.push("condition_children_invalid");
    for (const child of value) validateNode(child, depth + 1, state);
    return;
  }
  if (key === "not") return validateNode(value, depth + 1, state);
  if (!LEAF_KEYS.has(key) || BOOLEAN_KEYS.has(key)) return state.errors.push("condition_operator_unknown");
  validateLeaf(key, value, state.errors);
}

function validateLeaf(key, value, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return errors.push("condition_leaf_invalid");
  if (["discovery", "fictional_clearance", "relationship_discovered"].includes(key)) {
    const requiredKey = key === "relationship_discovered" ? "relationshipId" : "key";
    if (!onlyKeys(value, [requiredKey], ["present"])) return errors.push(`${key}_condition_invalid`);
    if (!validKey(value[requiredKey]) || (value.present !== undefined && typeof value.present !== "boolean")) errors.push(`${key}_condition_invalid`);
  } else if (key === "inventory_quantity") {
    if (!onlyKeys(value, ["itemKey", "op", "value"])) return errors.push("inventory_quantity_condition_invalid");
    if (!validKey(value.itemKey) || !COMPARISONS.has(value.op) || !Number.isSafeInteger(value.value) || value.value < 0) errors.push("inventory_quantity_condition_invalid");
  } else if (key === "inventory_instance") {
    if (!onlyKeys(value, ["itemKey"], ["state", "present"])) return errors.push("inventory_instance_condition_invalid");
    if (!validKey(value.itemKey) || !validKey(value.state || "held") || (value.present !== undefined && typeof value.present !== "boolean")) errors.push("inventory_instance_condition_invalid");
  } else if (key === "prior_event_count") {
    if (!onlyKeys(value, ["eventType", "op", "value"])) return errors.push("prior_event_count_condition_invalid");
    if (!validKey(value.eventType) || !COMPARISONS.has(value.op) || !Number.isSafeInteger(value.value) || value.value < 0) errors.push("prior_event_count_condition_invalid");
  } else if (key === "archive_state") {
    if (!onlyKeys(value, ["scopeType", "scopeKey", "path", "equals"])) return errors.push("archive_state_condition_invalid");
    if (!validKey(value.scopeType) || !validKey(value.scopeKey) || !validPath(value.path) || !("equals" in value)) errors.push("archive_state_condition_invalid");
  } else if (key === "event_payload") {
    if (!onlyKeys(value, ["field", "equals"])) return errors.push("event_payload_condition_invalid");
    if (!validKey(value.field) || !("equals" in value) || !scalar(value.equals)) errors.push("event_payload_condition_invalid");
  }
}

export function evaluateCondition(condition, snapshot) {
  const validation = validateCondition(condition);
  if (!validation.ok) return { matched: false, code: "condition_invalid", errors: validation.errors };
  return evaluateNode(condition, snapshot);
}

function evaluateNode(node, snapshot) {
  const [key, value] = Object.entries(node)[0];
  if (key === "all") {
    const children = value.map((child) => evaluateNode(child, snapshot));
    return { matched: children.every((child) => child.matched), code: "all", children };
  }
  if (key === "any") {
    const children = value.map((child) => evaluateNode(child, snapshot));
    return { matched: children.some((child) => child.matched), code: "any", children };
  }
  if (key === "not") {
    const child = evaluateNode(value, snapshot);
    return { matched: !child.matched, code: "not", children: [child] };
  }

  let actual;
  let expected;
  if (key === "discovery") {
    actual = snapshot.discoveries.has(value.key);
    expected = value.present !== false;
  } else if (key === "inventory_quantity") {
    actual = Number(snapshot.inventoryQuantities.get(value.itemKey) || 0);
    expected = value.value;
    return leaf(key, compare(actual, value.op, expected), actual, expected);
  } else if (key === "inventory_instance") {
    actual = snapshot.inventoryInstances.some((item) => item.itemKey === value.itemKey && item.state === (value.state || "held"));
    expected = value.present !== false;
  } else if (key === "fictional_clearance") {
    actual = snapshot.clearances.has(value.key);
    expected = value.present !== false;
  } else if (key === "prior_event_count") {
    actual = Number(snapshot.priorEventCounts.get(value.eventType) || 0);
    expected = value.value;
    return leaf(key, compare(actual, value.op, expected), actual, expected);
  } else if (key === "relationship_discovered") {
    actual = snapshot.relationships.has(value.relationshipId);
    expected = value.present !== false;
  } else if (key === "archive_state") {
    actual = getPath(snapshot.archiveStates.get(`${value.scopeType}:${value.scopeKey}`) || {}, value.path);
    expected = value.equals;
  } else if (key === "event_payload") {
    actual = snapshot.eventPayload[value.field];
    expected = value.equals;
  }
  return leaf(key, Object.is(actual, expected), actual, expected);
}

function leaf(code, matched, actual, expected) {
  return { matched, code, actual, expected };
}

function compare(actual, op, expected) {
  if (op === "eq") return actual === expected;
  if (op === "gte") return actual >= expected;
  if (op === "lte") return actual <= expected;
  if (op === "gt") return actual > expected;
  if (op === "lt") return actual < expected;
  return false;
}

function getPath(value, path) {
  return path.split(".").reduce((current, key) => current && typeof current === "object" ? current[key] : undefined, value);
}

function validKey(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function validPath(value) {
  return validKey(value) && !value.includes("__proto__") && !value.includes("constructor") && !value.includes("prototype");
}

function scalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function onlyKeys(value, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

export const CONDITION_LIMITS = { maxDepth: MAX_DEPTH, maxNodes: MAX_NODES, maxChildren: MAX_CHILDREN };
