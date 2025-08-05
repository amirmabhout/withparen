import neo4j from 'neo4j-driver';

export interface MemgraphConfig {
  host?: string;
  port?: string;
  username?: string;
  password?: string;
}

export interface PersonNode {
  userId: string;
  name?: string;
  pronouns?: string;
  updatedAt: string;
}

export interface HumanConnectionNode {
  partners: string[];
  secret: string;
  updatedAt: string;
}

export class MemgraphService {
  private driver: any;
  private config: MemgraphConfig;

  constructor(config: MemgraphConfig = {}) {
    this.config = {
      host: config.host || '127.0.0.1',
      port: config.port || '7687',
      username: config.username || '',
      password: config.password || '',
    };
  }

  async connect(): Promise<void> {
    const uri = `bolt://${this.config.host}:${this.config.port}`;
    this.driver = neo4j.driver(uri, neo4j.auth.basic(this.config.username, this.config.password));
  }

  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
    }
  }

  private async runQuery(query: string, parameters: any = {}): Promise<any> {
    if (!this.driver) {
      await this.connect();
    }
    
    const session = this.driver.session();
    try {
      const result = await session.run(query, parameters);
      return result;
    } finally {
      await session.close();
    }
  }

  /**
   * Check if a Person node exists for the given userId
   */
  async getPersonByUserId(userId: string): Promise<PersonNode | null> {
    const query = `
      MATCH (p:Person {userId: $userId})
      RETURN p
    `;

    const result = await this.runQuery(query, { userId });
    
    if (result.records.length === 0) {
      return null;
    }

    const personNode = result.records[0].get('p');
    return personNode.properties as PersonNode;
  }

  /**
   * Create a new Person node
   */
  async createPerson(userId: string, name?: string, pronouns?: string): Promise<PersonNode> {
    const updatedAt = new Date().toISOString();
    
    const query = `
      CREATE (p:Person {
        userId: $userId,
        name: $name,
        pronouns: $pronouns,
        updatedAt: $updatedAt
      })
      RETURN p
    `;

    const result = await this.runQuery(query, {
      userId,
      name: name || '',
      pronouns: pronouns || '',
      updatedAt,
    });

    const personNode = result.records[0].get('p');
    return personNode.properties as PersonNode;
  }

  /**
   * Check if a Person has any HumanConnection relationships
   */
  async hasHumanConnections(userId: string): Promise<boolean> {
    const query = `
      MATCH (p:Person {userId: $userId})-[:PARTICIPATES_IN]->(hc:HumanConnection)
      RETURN COUNT(hc) as connectionCount
    `;

    const result = await this.runQuery(query, { userId });
    const count = result.records[0].get('connectionCount').toNumber();
    
    return count > 0;
  }

  /**
   * Get all HumanConnections for a Person
   */
  async getHumanConnections(userId: string): Promise<HumanConnectionNode[]> {
    const query = `
      MATCH (p:Person {userId: $userId})-[:PARTICIPATES_IN]->(hc:HumanConnection)
      RETURN hc
    `;

    const result = await this.runQuery(query, { userId });
    
    return result.records.map((record: any) => {
      const connectionNode = record.get('hc');
      return connectionNode.properties as HumanConnectionNode;
    });
  }

  /**
   * Create a HumanConnection and link it to a Person
   */
  async createHumanConnection(
    userId: string,
    partnerName: string,
    secret: string
  ): Promise<HumanConnectionNode> {
    const updatedAt = new Date().toISOString();
    
    // Get the person's name first
    const person = await this.getPersonByUserId(userId);
    const userName = person?.name || 'User';
    
    const query = `
      MATCH (p:Person {userId: $userId})
      CREATE (hc:HumanConnection {
        partners: [$userName, $partnerName],
        secret: $secret,
        updatedAt: $updatedAt
      })
      CREATE (p)-[:PARTICIPATES_IN {role: "partner", updatedAt: $updatedAt}]->(hc)
      RETURN hc
    `;

    const result = await this.runQuery(query, {
      userId,
      userName,
      partnerName,
      secret,
      updatedAt,
    });

    const connectionNode = result.records[0].get('hc');
    return connectionNode.properties as HumanConnectionNode;
  }

  /**
   * Update Person's name
   */
  async updatePersonName(userId: string, name: string): Promise<PersonNode> {
    const updatedAt = new Date().toISOString();
    
    const query = `
      MATCH (p:Person {userId: $userId})
      SET p.name = $name, p.updatedAt = $updatedAt
      RETURN p
    `;

    const result = await this.runQuery(query, { userId, name, updatedAt });
    const personNode = result.records[0].get('p');
    return personNode.properties as PersonNode;
  }
}