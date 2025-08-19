# Memgraph Scripts

This directory contains scripts for interacting with the Memgraph database used by the Seren plugin.

## Prerequisites

- Memgraph running locally on `127.0.0.1:7687` (or configure via environment variables)
- Node.js and the `neo4j-driver` package installed
- System configured with proper `vm.max_map_count` setting (see System Configuration below)

## System Configuration

Memgraph requires the system's `vm.max_map_count` to be set to at least 524288 to prevent crashes.

**Quick setup:**

```bash
./scripts/configure-memgraph-system.sh
```

**Manual setup:**

```bash
# Set immediately
sudo sysctl vm.max_map_count=524288

# Make permanent (survives reboots)
echo "vm.max_map_count=524288" | sudo tee -a /etc/sysctl.conf
```

## Environment Configuration

The scripts read configuration from `packages/agentseren/.env`:

```
MEMGRAPH_HOST=127.0.0.1
MEMGRAPH_PORT=7687
```

## Available Commands

### updateMemgraph.ts

Unified script for all Memgraph operations using TypeScript.

**Clear all data:**

```bash
npx tsx scripts/updateMemgraph.ts clear
```

**Add a HumanConnection:**

```bash
npx tsx scripts/updateMemgraph.ts addConnection "person1, person2, secret"
```

**List all HumanConnections:**

```bash
npx tsx scripts/updateMemgraph.ts list
```

**Examples:**

```bash
# Clear everything
npx tsx scripts/updateMemgraph.ts clear

# Add connection between amir and bianca with secret "popcorn"
npx tsx scripts/updateMemgraph.ts addConnection "amir, bianca, popcorn"

# List all connections
npx tsx scripts/updateMemgraph.ts list
```

**What addConnection does:**

- Creates a HumanConnection node with:
  - `partners: ["person1", "person2"]`
  - `secret: "shared_secret"`
  - `updatedAt: <current timestamp>`
- No Person nodes or relationships are created (just the HumanConnection node)

## Schema Reference

The HumanConnection node follows this schema (from `packages/plugin-seren/src/utils/graphSchema.ts`):

```javascript
HumanConnection: {
  partners: [],      // [person1 name, person2 name]
  secret: "",        // string, secret set by invitee that only the two know
  updatedAt: ""      // ISO timestamp
}
```

## Relationships

- `Person -[:PARTICIPATES_IN {role: "partner", updatedAt: "..."}]-> HumanConnection`

## Features

- **Hardcoded configuration**: No need for environment variables (uses 127.0.0.1:7687)
- **TypeScript**: Modern TypeScript with proper error handling
- **Command-line interface**: Easy to use with clear commands
- **Consolidated**: All Memgraph operations in one file
- **Validation**: Proper input validation and error messages
