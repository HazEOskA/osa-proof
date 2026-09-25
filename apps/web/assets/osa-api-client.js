(function (global) {
  "use strict";

  class OsaApiClient {
    constructor(options = {}) {
      this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    }

    async request(path, options = {}) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          "content-type": "application/json",
          ...(options.headers || {})
        }
      });
      const text = await response.text();
      let body = null;
      if (text) {
        try { body = JSON.parse(text); } catch { body = text; }
      }
      if (!response.ok) {
        const error = new Error(`OSA API ${response.status}: ${path}`);
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    }

    listLayers() {
      return this.request("/layers");
    }

    getLayer(layerId) {
      return this.request(`/layers/${encodeURIComponent(layerId)}`);
    }

    enterLayer(layerId) {
      return this.request(`/layers/${encodeURIComponent(layerId)}/enter`, { method: "POST" });
    }

    createTeam(teamGraph) {
      return this.request("/teams", { method: "POST", body: JSON.stringify(teamGraph) });
    }

    getTeam(teamId, version) {
      return this.request(`/teams/${encodeURIComponent(teamId)}?version=${encodeURIComponent(version)}`);
    }

    createMission(mission) {
      return this.request("/missions", { method: "POST", body: JSON.stringify(mission) });
    }

    runMission(missionId) {
      return this.request(`/missions/${encodeURIComponent(missionId)}/run`, { method: "POST" });
    }

    getRun(runId) {
      return this.request(`/runs/${encodeURIComponent(runId)}`);
    }

    getRunEvents(runId) {
      return this.request(`/runs/${encodeURIComponent(runId)}/events`);
    }

    getRunEvidence(runId) {
      return this.request(`/runs/${encodeURIComponent(runId)}/evidence`);
    }

    getRunProof(runId) {
      return this.request(`/runs/${encodeURIComponent(runId)}/proof`);
    }
  }

  global.OsaApiClient = OsaApiClient;
  global.OSA_API = new OsaApiClient({ baseUrl: global.OSA_API_BASE_URL || "" });
})(window);
