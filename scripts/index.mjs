export const scriptGroups = Object.freeze({
  validation: ['check-agent-corpus', 'check-docs', 'ci-report', 'scan-secrets', 'test-ci'],
  onboarding: ['doctor', 'setup', 'dev-environment', 'install-hooks'],
  maintenance: ['maintenance', 'verify-maintenance-loop'],
  agentTools: ['mcp-server'],
});
