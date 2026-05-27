const toolsEl = document.querySelector('#tools');
const workspaceEl = document.querySelector('#workspace');
const AUTO_REFRESH_MS = 60_000;
setWorkspaceBadge({ placeholder: 'Loading workspace…' });
loadStatus();
setInterval(loadStatus, AUTO_REFRESH_MS);

function workspaceParam() {
  return new URLSearchParams(location.search).get('workspace');
}

function statusUrl() {
  const params = new URLSearchParams(location.search);
  return `api/tools${params.toString() ? `?${params}` : ''}`;
}

async function loadStatus() {
  toolsEl.innerHTML = '<article class="tool-card muted">Loading tool status…</article>';
  try {
    const res = await fetch(statusUrl());
    if (!res.ok) throw new Error(`Status request failed: ${res.status}`);
    const data = await res.json();
    setWorkspaceBadge({ name: data.workspaceName, root: data.workspaceRoot, workspaces: data.workspaces, currentWorkspace: data.currentWorkspace });
    toolsEl.innerHTML = `${data.tools.map(renderTool).join('')}${renderPlaceholderCard()}`;
  } catch (error) {
    setWorkspaceBadge({ unavailable: true });
    toolsEl.innerHTML = `<article class="tool-card danger"><h3>Status unavailable</h3><p>${escapeHtml(error.message || 'Unknown error')}</p></article>`;
  }
}

function renderTool(tool) {
  const disabled = tool.status === 'unavailable';
  return `
    <article class="tool-card">
      <div class="tool-head">
        <div class="tool-title">
          <img class="tool-icon" src="${escapeHtml(tool.icon)}" alt="" width="52" height="52">
          <div>
            <p class="tool-kicker">mounted local tool</p>
            <h3>${escapeHtml(tool.title)}</h3>
          </div>
        </div>
        <span class="pill ${escapeHtml(tool.status)}">${escapeHtml(tool.status)}</span>
      </div>
      <p class="tool-description">${escapeHtml(tool.description)}</p>
      <p class="detail">${escapeHtml(tool.detail || '')}</p>
      <div class="actions">
        ${disabled ? '' : `<a class="button" href="${escapeHtml(tool.route)}">${escapeHtml(tool.action)}</a>`}
        ${disabled ? '' : `<a class="ghost" href="${escapeHtml(tool.api)}">Check API</a>`}
      </div>
    </article>`;
}

function renderPlaceholderCard() {
  return `
    <article class="tool-card placeholder-card" aria-label="Future tool placeholder">
      <div class="placeholder-plus">+</div>
      <h3>Next tool</h3>
      <p>Room for the next focused framework tool when a real workflow earns it.</p>
    </article>`;
}

function setWorkspaceBadge(options) {
  window.FrameworkWorkspaceBadge?.set(workspaceEl, { tooltipPrefix: 'Workspace', ...options });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}
