import { type ClaimHistory, type InsertClaimHistory } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  createClaimHistory(claim: InsertClaimHistory): Promise<ClaimHistory>;
  getClaimHistory(limit?: number): Promise<ClaimHistory[]>;
  getClaimHistoryByWallet(walletAddress: string): Promise<ClaimHistory[]>;
}

export class MemStorage implements IStorage {
  private claimHistory: Map<string, ClaimHistory>;

  constructor() {
    this.claimHistory = new Map();
  }

  async createClaimHistory(insertClaim: InsertClaimHistory): Promise<ClaimHistory> {
    const id = randomUUID();
    const claim: ClaimHistory = {
      walletAddress: insertClaim.walletAddress,
      amount: insertClaim.amount,
      transactionHash: insertClaim.transactionHash ?? null,
      id,
      claimedAt: new Date(),
    };
    this.claimHistory.set(id, claim);
    return claim;
  }

  async getClaimHistory(limit: number = 50): Promise<ClaimHistory[]> {
    const claims = Array.from(this.claimHistory.values());
    return claims.sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime()).slice(0, limit);
  }

  async getClaimHistoryByWallet(walletAddress: string): Promise<ClaimHistory[]> {
    const claims = Array.from(this.claimHistory.values()).filter(
      (claim) => claim.walletAddress.toLowerCase() === walletAddress.toLowerCase()
    );
    return claims.sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime());
  }
}

export const storage = new MemStorage();
