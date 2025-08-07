import neo4j from 'neo4j-driver';

export interface MemgraphConfig {
  host?: string;
  port?: string;
  username?: string;
  password?: string;
}

export interface HumanConnectionNode {
  partners: string[];
  secret: string;
  status: string;
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
    this.driver = neo4j.driver(uri, neo4j.auth.basic(this.config.username || '', this.config.password || ''));
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
   * Create a HumanConnection node with waitlist status
   */
  async createHumanConnectionWithWaitlist(
    userName: string,
    partnerName: string,
    secret: string
  ): Promise<HumanConnectionNode> {
    const updatedAt = new Date().toISOString();
    
    const query = `
      CREATE (hc:HumanConnection {
        partners: [$userName, $partnerName],
        secret: $secret,
        status: "waitlist",
        updatedAt: $updatedAt
      })
      RETURN hc
    `;

    const result = await this.runQuery(query, {
      userName,
      partnerName,
      secret,
      updatedAt,
    });

    const connectionNode = result.records[0].get('hc');
    return connectionNode.properties as HumanConnectionNode;
  }

  /**
   * Check if a HumanConnection already exists with the same partners and secret
   */
  async findExistingHumanConnection(
    userName: string,
    partnerName: string,
    secret: string
  ): Promise<HumanConnectionNode | null> {
    const query = `
      MATCH (hc:HumanConnection)
      WHERE hc.secret = $secret 
      AND (
        (hc.partners[0] = $userName AND hc.partners[1] = $partnerName) OR
        (hc.partners[0] = $partnerName AND hc.partners[1] = $userName)
      )
      RETURN hc
    `;

    const result = await this.runQuery(query, { 
      userName, 
      partnerName, 
      secret 
    });
    
    if (result.records.length === 0) {
      return null;
    }

    const connectionNode = result.records[0].get('hc');
    return connectionNode.properties as HumanConnectionNode;
  }

  /**
   * Get all HumanConnection nodes with waitlist status
   */
  async getWaitlistConnections(): Promise<HumanConnectionNode[]> {
    const query = `
      MATCH (hc:HumanConnection {status: "waitlist"})
      RETURN hc
    `;

    const result = await this.runQuery(query);
    
    return result.records.map((record: any) => {
      const connectionNode = record.get('hc');
      return connectionNode.properties as HumanConnectionNode;
    });
  }

  /**
   * Update HumanConnection status
   */
  async updateConnectionStatus(
    partners: string[],
    secret: string,
    newStatus: string
  ): Promise<HumanConnectionNode | null> {
    const updatedAt = new Date().toISOString();
    
    const query = `
      MATCH (hc:HumanConnection {secret: $secret})
      WHERE hc.partners = $partners
      SET hc.status = $newStatus, hc.updatedAt = $updatedAt
      RETURN hc
    `;

    const result = await this.runQuery(query, {
      partners,
      secret,
      newStatus,
      updatedAt,
    });

    if (result.records.length === 0) {
      return null;
    }

    const connectionNode = result.records[0].get('hc');
    return connectionNode.properties as HumanConnectionNode;
  }
}