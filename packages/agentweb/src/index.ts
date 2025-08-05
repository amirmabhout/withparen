import { logger, type IAgentRuntime, type Project, type ProjectAgent } from '@elizaos/core';
//import serenWebPlugin from './plugin-seren-web/src/index.ts';
import { character } from './character.ts';

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
export { testSuites } from './__tests__/e2e/index.ts';
export { character } from './character.ts';

export default project;