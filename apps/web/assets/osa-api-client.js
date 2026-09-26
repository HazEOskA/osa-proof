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

    async runDevMission(objective) {
      const request = String(objective ?? "").trim();
      if (!request) throw new Error("DEV mission objective is required");

      const team = {
        organization_id: "org_dev_fixture",
        project_id: "project_dev_live_slice",
        team_id: "team_dev_fixture",
        version: "1",
        agents: [
          { agent_id: "planner", role: "planner", executor_ref: "dev.planner.fixture.v1" },
          { agent_id: "builder", role: "builder", executor_ref: "dev.builder.fixture.v1" }
        ],
        edges: [
          {
            edge_id: "planner_to_builder",
            from_agent_id: "planner",
            to_agent_id: "builder",
            kind: "handoff"
          }
        ]
      };

      const mission = {
        organization_id: team.organization_id,
        project_id: team.project_id,
        mission_id: `mission_dev_${Date.now()}`,
        team_id: team.team_id,
        team_version: team.version,
        objective: request,
        entry_agent_id: "planner",
        input: { request },
        requirements: [
          {
            requirement_id: "artifact_status",
            type: "evidence_field_equals",
            evidence_kind: "artifact",
            agent_id: "builder",
            field: "status",
            expected: "built"
          }
        ]
      };

      await this.createTeam(team);
      await this.createMission(mission);
      const run = await this.runMission(mission.mission_id);
      const [events, evidence, proof] = await Promise.all([
        this.getRunEvents(run.run_id),
        this.getRunEvidence(run.run_id),
        this.getRunProof(run.run_id)
      ]);

      return { team, mission, run, events, evidence, proof };
    }
  }

  global.OsaApiClient = OsaApiClient;
  global.OSA_API = new OsaApiClient({ baseUrl: global.OSA_API_BASE_URL || "" });
})(window);
