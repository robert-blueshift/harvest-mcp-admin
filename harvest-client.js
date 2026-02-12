import fetch from "node-fetch";

export class HarvestClient {
  constructor(accessToken, accountId) {
    this.accessToken = accessToken;
    this.accountId = accountId;
    this.baseUrl = "https://api.harvestapp.com/v2";
    this.userAgent = "HarvestMCP (harvest-mcp-server)";
  }

  async request(method, path, body = null, queryParams = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });

    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      "Harvest-Account-Id": this.accountId,
      "User-Agent": this.userAgent,
      "Content-Type": "application/json",
    };

    const options = { method, headers };
    if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Harvest API ${response.status}: ${errorText}`);
    }

    if (response.status === 200 || response.status === 201) {
      return await response.json();
    }
    return { success: true, status: response.status };
  }

  async fetchAll(path, listKey, queryParams = {}) {
    const all = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const result = await this.request("GET", path, null, { ...queryParams, page, per_page: 100 });
      const items = result[listKey] || result.project_assignments || [];
      all.push(...items);
      hasMore = result.next_page !== null;
      page++;
    }
    return all;
  }

  async getMe() { return this.request("GET", "/users/me"); }
  async getCompany() { return this.request("GET", "/company"); }

  async listUsers(queryParams = {}) { return this.request("GET", "/users", null, queryParams); }
  async getUser(userId) { return this.request("GET", `/users/${userId}`); }
  async createUser(body) { return this.request("POST", "/users", body); }
  async updateUser(userId, body) { return this.request("PATCH", `/users/${userId}`, body); }
  async deleteUser(userId) { return this.request("DELETE", `/users/${userId}`); }

  async listProjects(queryParams = {}) { return this.request("GET", "/projects", null, queryParams); }
  async getProject(projectId) { return this.request("GET", `/projects/${projectId}`); }
  async createProject(body) { return this.request("POST", "/projects", body); }
  async updateProject(projectId, body) { return this.request("PATCH", `/projects/${projectId}`, body); }
  async deleteProject(projectId) { return this.request("DELETE", `/projects/${projectId}`); }

  async listTasks(queryParams = {}) { return this.request("GET", "/tasks", null, queryParams); }
  async getTask(taskId) { return this.request("GET", `/tasks/${taskId}`); }
  async createTask(body) { return this.request("POST", "/tasks", body); }
  async updateTask(taskId, body) { return this.request("PATCH", `/tasks/${taskId}`, body); }
  async deleteTask(taskId) { return this.request("DELETE", `/tasks/${taskId}`); }

  async listProjectTaskAssignments(projectId, queryParams = {}) { return this.request("GET", `/projects/${projectId}/task_assignments`, null, queryParams); }
  async createProjectTaskAssignment(projectId, body) { return this.request("POST", `/projects/${projectId}/task_assignments`, body); }
  async updateProjectTaskAssignment(projectId, assignmentId, body) { return this.request("PATCH", `/projects/${projectId}/task_assignments/${assignmentId}`, body); }
  async deleteProjectTaskAssignment(projectId, assignmentId) { return this.request("DELETE", `/projects/${projectId}/task_assignments/${assignmentId}`); }

  async listProjectUserAssignments(projectId, queryParams = {}) { return this.request("GET", `/projects/${projectId}/user_assignments`, null, queryParams); }
  async createProjectUserAssignment(projectId, body) { return this.request("POST", `/projects/${projectId}/user_assignments`, body); }
  async updateProjectUserAssignment(projectId, assignmentId, body) { return this.request("PATCH", `/projects/${projectId}/user_assignments/${assignmentId}`, body); }
  async deleteProjectUserAssignment(projectId, assignmentId) { return this.request("DELETE", `/projects/${projectId}/user_assignments/${assignmentId}`); }

  async listMyProjectAssignments(queryParams = {}) { return this.request("GET", "/users/me/project_assignments", null, queryParams); }

  async listClients(queryParams = {}) { return this.request("GET", "/clients", null, queryParams); }
  async getClient(clientId) { return this.request("GET", `/clients/${clientId}`); }
  async createClient(body) { return this.request("POST", "/clients", body); }
  async updateClient(clientId, body) { return this.request("PATCH", `/clients/${clientId}`, body); }
  async deleteClient(clientId) { return this.request("DELETE", `/clients/${clientId}`); }

  async listTimeEntries(queryParams = {}) { return this.request("GET", "/time_entries", null, queryParams); }
  async getTimeEntry(timeEntryId) { return this.request("GET", `/time_entries/${timeEntryId}`); }
  async createTimeEntry(body) { return this.request("POST", "/time_entries", body); }
  async updateTimeEntry(timeEntryId, body) { return this.request("PATCH", `/time_entries/${timeEntryId}`, body); }
  async deleteTimeEntry(timeEntryId) { return this.request("DELETE", `/time_entries/${timeEntryId}`); }
  async restartTimeEntry(timeEntryId) { return this.request("PATCH", `/time_entries/${timeEntryId}/restart`); }
  async stopTimeEntry(timeEntryId) { return this.request("PATCH", `/time_entries/${timeEntryId}/stop`); }

  async getTimeReport(type, from, to) { return this.request("GET", `/reports/time/${type}`, null, { from, to }); }
  async listInvoices(queryParams = {}) { return this.request("GET", "/invoices", null, queryParams); }
  async listExpenses(queryParams = {}) { return this.request("GET", "/expenses", null, queryParams); }
  async listRoles(queryParams = {}) { return this.request("GET", "/roles", null, queryParams); }
}
