import { randomUUID } from "node:crypto";
import { AgentExecutor } from "../../contracts/src";
import { Capability, CapabilityCatalog } from "./index";
import { readBoundedResponse } from "../../deployment/src";
export interface McpTool { name: string; description?: string; inputSchema: Record<string,unknown> }
/** Streamable HTTP transport, JSON responses only. SSE/stdio servers fail closed, never reported healthy. */
export class McpHttpIntegration {
  private sessionId?: string;
  private initialized = false;
  constructor(private readonly options: { url: string; token?: string; server_id: string; version: string; fetchImpl?: typeof fetch }) {
    const u=new URL(options.url);
    if (!options.server_id || !options.version || u.username || u.password || u.hash || u.search || (u.protocol!=="https:" && !(u.protocol==="http:" && ["localhost","127.0.0.1","[::1]"].includes(u.hostname)))) throw new Error("MCP_CONFIG_INVALID");
  }
  async discover(): Promise<McpTool[]> {
    if (!this.initialized) {
      const result=await this.rpc("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"osa-proof",version:"0.5"}}) as any;
      if (result.protocolVersion!=="2025-03-26" || !result.capabilities?.tools) throw new Error("MCP_PROTOCOL_UNSUPPORTED");
      await this.notify("notifications/initialized"); this.initialized=true;
    }
    const result=await this.rpc("tools/list",{}) as any;
    if (!Array.isArray(result.tools) || result.nextCursor || result.tools.length>128 || result.tools.some((t:any)=>!t || typeof t.name!=="string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(t.name) || !t.inputSchema || typeof t.inputSchema!=="object" || Array.isArray(t.inputSchema)) || new Set(result.tools.map((t:any)=>t.name)).size!==result.tools.length) throw new Error("MCP_TOOL_LIST_INVALID");
    return structuredClone(result.tools);
  }
  async register(catalog: CapabilityCatalog): Promise<void> {
    const tools=await this.discover();
    const entries:Array<{definition:Capability;execute:AgentExecutor}>=[];
    for (const tool of tools) {
      const ref=`mcp.${this.options.server_id}.${tool.name}`;
      const definition: Capability={capability_id:ref,version:this.options.version,kind:"MCP",capabilities:[tool.name],permissions:[`mcp:${this.options.server_id}:${tool.name}`],inputs:tool.inputSchema,outputs:{},cost:{unit:"call",amount:null},risk:"UNKNOWN",health:"READY",executor_ref:ref};
      const executor: AgentExecutor=async context=>{
        const result=await this.rpc("tools/call",{name:tool.name,arguments:context.input},context.mission.mission_id) as any;
        if (result.isError || !Array.isArray(result.content)) throw new Error("MCP_TOOL_EXECUTION_FAILED");
        return {output:structuredClone(result),evidence:[]}; // Catalog wrapper supplies ToolReceipt.
      };
      entries.push({definition,execute:executor});
    }
    catalog.registerBatch(entries);
  }
  private async rpc(method:string,params:unknown,missionId?:string):Promise<unknown> {
    const id=randomUUID();const response=await this.request({jsonrpc:"2.0",id,method,params},missionId);
    const type=response.headers.get("content-type")??"";if(!type.includes("application/json"))throw new Error("MCP_RESPONSE_FORMAT_UNSUPPORTED");
    const message=JSON.parse(await readBoundedResponse(response,1024*1024));
    if(message.jsonrpc!=="2.0" || message.id!==id || message.error || message.result===undefined)throw new Error("MCP_RPC_FAILED");
    return message.result;
  }
  private async notify(method:string):Promise<void> {const response=await this.request({jsonrpc:"2.0",method});if(response.status!==202)throw new Error("MCP_NOTIFICATION_REJECTED");await readBoundedResponse(response,1024*1024);}
  private async request(body:unknown,missionId?:string):Promise<Response> {
    const headers:Record<string,string>={"content-type":"application/json",accept:"application/json, text/event-stream","MCP-Protocol-Version":"2025-03-26"};
    if(this.options.token)headers.authorization=`Bearer ${this.options.token}`;if(this.sessionId)headers["Mcp-Session-Id"]=this.sessionId;if(missionId)headers["x-osa-mission-id"]=encodeURIComponent(missionId);
    const response=await(this.options.fetchImpl??fetch)(this.options.url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers,body:JSON.stringify(body)});
    if(!response.ok)throw new Error(`MCP_HTTP_${response.status}`);
    const session=response.headers.get("Mcp-Session-Id");if(session){if(session.length>256 || /[\r\n]/.test(session))throw new Error("MCP_SESSION_INVALID");this.sessionId=session;}
    return response;
  }
}
