import "server-only";

import { randomUUID } from "node:crypto";

import {
  createAuthPersistenceRepositories,
  AuthRepositoryError,
  hashPassword,
  validatePasswordStrength,
  type AuthRepository,
  type AuthUser,
} from "@/lib/server/auth";
import {
  createNewApiUserSyncService,
  type NewApiUserMappingRepository,
  type NewApiUserSyncService,
} from "@/lib/server/integrations/new-api";
import { applicationQuery } from "@/lib/server/database";
import { isValidEmail, isValidUsername, normalizeEmail, normalizeUsername, publicSafeString, sha256 } from "@/lib/server/auth/normalize";
import type { TeamUsageSummary } from "@/lib/server/team-usage";

export type { TeamUsageSummary } from "@/lib/server/team-usage";

export type TeamMember = {
  localUserId: string;
  username: string;
  displayName: string;
  email: string;
  status: AuthUser["status"];
  createdAt: string;
  lastLoginAt: string | null;
  currentCredits: number | null;
  usage: TeamUsageSummary;
};

export class TeamServiceError extends Error {
  constructor(
    readonly code: "TEAM_FORBIDDEN" | "TEAM_INVALID_REQUEST" | "TEAM_DUPLICATE_ACCOUNT" | "TEAM_CREATE_FAILED",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TeamServiceError";
  }
}

export type TeamServiceDependencies = {
  authRepository?: AuthRepository;
  mappingRepository?: NewApiUserMappingRepository;
  userSyncService?: Pick<NewApiUserSyncService, "ensureMapped">;
  now?: () => Date;
};

function initialChildCredits() {
  const configured = Number(process.env.TEAM_CHILD_INITIAL_CREDITS || 0);
  return Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : 0;
}

function dateRange(input: { from?: string; to?: string }) {
  const now = new Date();
  const to = input.to && !Number.isNaN(Date.parse(input.to)) ? new Date(input.to) : now;
  const from = input.from && !Number.isNaN(Date.parse(input.from))
    ? new Date(input.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export class TeamService {
  private readonly authRepository: AuthRepository;
  private readonly mappingRepository: NewApiUserMappingRepository;
  private readonly userSyncService: Pick<NewApiUserSyncService, "ensureMapped">;
  private readonly now: () => Date;

  constructor(dependencies: TeamServiceDependencies = {}) {
    let authRepository = dependencies.authRepository;
    let mappingRepository = dependencies.mappingRepository;
    if (!authRepository || !mappingRepository) {
      const persistence = createAuthPersistenceRepositories();
      authRepository = authRepository || persistence.authRepository;
      mappingRepository = mappingRepository || persistence.mappingRepository;
    }
    this.authRepository = authRepository;
    this.mappingRepository = mappingRepository;
    this.userSyncService = dependencies.userSyncService || createNewApiUserSyncService({ repository: mappingRepository });
    this.now = dependencies.now || (() => new Date());
  }

  async getOwnerIdForUser(localUserId: string) {
    const user = await this.authRepository.getUserById(localUserId);
    if (!user || user.status !== "active" || user.account_owner_id) return null;
    return user.local_user_id;
  }

  async createMember(input: {
    ownerId: string;
    email: string;
    username: string;
    displayName?: string;
    password: string;
  }) {
    const owner = await this.authRepository.getUserById(input.ownerId);
    if (!owner || owner.status !== "active" || owner.account_owner_id) {
      throw new TeamServiceError("TEAM_FORBIDDEN", "只有主账号可以管理子账号。", 403);
    }
    const email = normalizeEmail(input.email);
    const username = normalizeUsername(input.username);
    if (!isValidEmail(email) || !isValidUsername(username) || validatePasswordStrength(input.password).length > 0) {
      throw new TeamServiceError("TEAM_INVALID_REQUEST", "子账号信息或密码格式无效。", 400);
    }
    const existingEmail = await this.authRepository.getUserByIdentifier(email);
    const existingUsername = await this.authRepository.getUserByIdentifier(username);
    if (existingEmail || existingUsername) {
      throw new TeamServiceError("TEAM_DUPLICATE_ACCOUNT", "邮箱或用户名已经存在。", 409);
    }

    let user: AuthUser;
    try {
      user = await this.authRepository.createUser({
        localUserId: randomUUID(),
        accountOwnerId: owner.local_user_id,
        email,
        phone: null,
        username,
        displayName: publicSafeString(input.displayName || username, 80),
        passwordHash: await hashPassword(input.password),
        status: "active",
        role: "user",
        now: this.now(),
      });
    } catch (error) {
      if (error instanceof AuthRepositoryError && error.code === "AUTH_DUPLICATE_ACCOUNT") {
        throw new TeamServiceError("TEAM_DUPLICATE_ACCOUNT", "邮箱或用户名已经存在。", 409);
      }
      throw error;
    }
    const mapping = await this.userSyncService.ensureMapped({
      localUserId: user.local_user_id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      initialQuota: initialChildCredits(),
    }, {
      idempotencyKey: `team:create:${user.local_user_id}`,
      passwordSeed: sha256(`${user.local_user_id}:${input.password}`).slice(0, 16),
    }).catch(async () => {
      await this.authRepository.updateUser(user.local_user_id, { status: "verification_required" }, this.now());
      throw new TeamServiceError("TEAM_CREATE_FAILED", "子账号创建成功但服务映射未完成，请联系管理员修复。", 503);
    });
    if (mapping.mapping.sync_status !== "active") {
      await this.authRepository.updateUser(user.local_user_id, { status: "verification_required" }, this.now());
      throw new TeamServiceError("TEAM_CREATE_FAILED", "子账号服务映射未完成，请稍后重试。", 503);
    }
    return this.toMember(user, { creditUnits: 0, imageTasks: 0, videoTasks: 0 }, null);
  }

  async getOverview(ownerId: string, input: { from?: string; to?: string } = {}) {
    const owner = await this.authRepository.getUserById(ownerId);
    if (!owner || owner.status !== "active" || owner.account_owner_id) {
      throw new TeamServiceError("TEAM_FORBIDDEN", "只有主账号可以查看团队用量。", 403);
    }
    const membersPage = await this.authRepository.listUsersPage({ page: 1, pageSize: 100 });
    const members = membersPage.users.filter((user) => user.local_user_id === ownerId || user.account_owner_id === ownerId);
    const range = dateRange(input);
    const ids = members.map((member) => member.local_user_id);
    const usage = ids.length ? await applicationQuery<{
      local_user_id: string;
      credit_units: string;
      image_tasks: string;
      video_tasks: string;
    }>(`
      select u.local_user_id,
        coalesce(sum(case when u.actual_quota_units is not null then u.actual_quota_units else u.estimated_quota_units end)
          filter (where u.status in ('prechecked', 'accepted', 'succeeded', 'reconciliation_required')), 0)::text as credit_units,
        count(*) filter (where u.operation like 'cloud_image%' and u.status in ('prechecked', 'accepted', 'succeeded', 'reconciliation_required'))::text as image_tasks,
        count(*) filter (where u.operation like 'cloud_video%' and u.status in ('prechecked', 'accepted', 'succeeded', 'reconciliation_required'))::text as video_tasks
      from usage_records u
      where u.local_user_id = any($1::uuid[]) and u.created_at >= $2 and u.created_at < $3
      group by u.local_user_id
    `, [ids, range.from, range.to]) : { rows: [] };
    const usageByUser = new Map(usage.rows.map((row) => [row.local_user_id, {
      creditUnits: Number(row.credit_units || 0),
      imageTasks: Number(row.image_tasks || 0),
      videoTasks: Number(row.video_tasks || 0),
    }]));
    const result = members.map((user) => this.toMember(
      user,
      usageByUser.get(user.local_user_id) || { creditUnits: 0, imageTasks: 0, videoTasks: 0 },
      null,
    ));
    const totals = result.reduce<TeamUsageSummary>((summary, member) => ({
      creditUnits: summary.creditUnits + member.usage.creditUnits,
      imageTasks: summary.imageTasks + member.usage.imageTasks,
      videoTasks: summary.videoTasks + member.usage.videoTasks,
    }), { creditUnits: 0, imageTasks: 0, videoTasks: 0 });
    return { ownerId, range, members: result, totals };
  }

  private toMember(user: AuthUser, usage: TeamUsageSummary, currentCredits: number | null): TeamMember {
    return {
      localUserId: user.local_user_id,
      username: user.username,
      displayName: user.display_name,
      email: user.email,
      status: user.status,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      currentCredits,
      usage,
    };
  }
}

let defaultTeamService: TeamService | null = null;

export function getTeamService() {
  if (!defaultTeamService) defaultTeamService = new TeamService();
  return defaultTeamService;
}

export function createTeamService(dependencies?: TeamServiceDependencies) {
  return new TeamService(dependencies);
}
