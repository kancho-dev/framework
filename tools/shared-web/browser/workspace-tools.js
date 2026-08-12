export function workspaceAllowsTool(workspace, toolId) {
  if (toolId === 'tokens-cost-analyzer') return workspace?.tools?.[toolId] === true;
  return workspace?.tools?.[toolId] !== false;
}

export function workspaceFilterForTool(toolId) {
  return (workspace) => workspaceAllowsTool(workspace, toolId);
}
