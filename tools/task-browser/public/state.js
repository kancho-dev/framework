export const state = {
  tasks: [],
  selectedKey: null,
  statuses: [],
  priorities: [],
  workspaceRoot: '',
  metadataPath: '',
  selectedStatuses: new Set(),
  tagDrafts: {},
  relationDrafts: {},
  steeringDrafts: {},
  steeringOpen: {},
  relationEditorOpen: false,
  revealSelectedInBoard: false,
};

const projectColors = new Map();

export function selectedTask() {
  return state.selectedKey ? state.tasks.find((task) => task.key === state.selectedKey) : null;
}

export function selectTaskKey(key) {
  if (state.selectedKey !== key) state.relationEditorOpen = false;
  state.selectedKey = key;
  persistSelectedKey();
}

export function continuityKey() {
  return `framework.task-browser.selectedKey:${state.workspaceRoot || location.pathname}`;
}

export function filtersContinuityKey() {
  return `framework.task-browser.filters:${state.workspaceRoot || location.pathname}`;
}

export function persistSelectedKey() {
  if (state.selectedKey) localStorage.setItem(continuityKey(), state.selectedKey);
  else localStorage.removeItem(continuityKey());
}

export function projectColor(project) {
  if (projectColors.has(project)) return projectColors.get(project);
  const hue = hashString(project) % 360;
  const color = `hsl(${hue} 72% 68%)`;
  projectColors.set(project, color);
  return color;
}

function hashString(value) {
  return [...String(value)].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 17);
}
