#!/usr/bin/env node
import { FastMCP } from 'fastmcp';
import { tools } from './tools.js';

const server = new FastMCP({ name: 'mcp-hylo', version: '0.1.0' });
server.addTool(tools[0]);
server.addTool(tools[1]);
server.addTool(tools[2]);
server.addTool(tools[3]);
await server.start({ transportType: 'stdio' });
