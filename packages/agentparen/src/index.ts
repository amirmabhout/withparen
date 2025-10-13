const { logger } = require('@elizaos/core');
import { character } from './character.ts';

// Type definitions for this project
interface IAgentRuntime {
  agentId: string;
}

interface ProjectAgent {
  character: any;
  init?: (runtime: IAgentRuntime) => Promise<void>;
  plugins?: any[];
  tests?: any;
}

interface Project {
  agents: ProjectAgent[];
}

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info('Initializing character');
  logger.info('Name: ', character.name);
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => await initCharacter({ runtime }),
  //  plugins: [serenWebPlugin], //<-- Import custom plugins here
};
const project: Project = {
  agents: [projectAgent],
};

// Export test suites for the test runner
export { character } from './character.ts';

export default project;
