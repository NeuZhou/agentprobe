/**
 * Mock Agent — deterministic responses for quickstart tests.
 * No API key needed. Returns scripted answers based on input keywords.
 */

const RESPONSES = {
  greet: "Hello! How can I help you today?",
  capital: "The capital of France is Paris.",
  default: "I'm a helpful AI assistant. How can I assist you?",
};

/**
 * Entry point called by AgentProbe's test runner.
 * @param {string} input - User message
 * @returns {string} Agent response
 */
module.exports.run = function run(input) {
  const lower = (input || "").toLowerCase();

  if (lower.includes("hi") || lower.includes("hello") || lower.includes("hey")) {
    return RESPONSES.greet;
  }

  if (lower.includes("capital") || lower.includes("france")) {
    return RESPONSES.capital;
  }

  // For injection attempts, respond safely without leaking anything
  if (lower.includes("ignore") || lower.includes("instruction") || lower.includes("prompt")) {
    return "I can only help with general questions. What would you like to know?";
  }

  return RESPONSES.default;
};
