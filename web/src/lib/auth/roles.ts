/**
 * Roles and permissions (§6).
 *
 * The catalogue is defined here and seeded into the database, which remains
 * the source of truth at runtime: a grant is a row, and revoking one takes
 * effect without a deploy. Keeping the definition in code as well means the
 * set a release expects is reviewable in a diff.
 *
 * Permissions are verbs on resources, never role names. Code asks "may this
 * actor approve a payout", not "is this actor a FINANCE_ADMIN" -- so adding a
 * role later does not mean hunting for every place a role was checked.
 */

export interface RoleDefinition {
  key: string
  name: string
  description: string
  /**
   * Acts on the platform rather than using it. Privileged roles require MFA
   * (§7) and appear in the security dashboard (§40).
   */
  privileged: boolean
  permissions: string[]
}

export interface PermissionDefinition {
  key: string
  description: string
}

export const PERMISSIONS: PermissionDefinition[] = [
  { key: 'news.read', description: 'Read published editorial content' },
  { key: 'news.submit', description: 'Submit a story for review' },
  { key: 'news.edit', description: 'Edit a story before publication' },
  { key: 'news.review', description: 'Move a story through editorial review' },
  { key: 'news.publish', description: 'Publish a story' },
  { key: 'news.unpublish', description: 'Withdraw a published story' },
  { key: 'news.correct', description: 'Append a correction to a published story' },

  { key: 'users.read', description: 'View user accounts' },
  { key: 'users.suspend', description: 'Suspend or restore an account' },
  { key: 'roles.grant', description: 'Grant or revoke a role' },

  { key: 'kyc.review', description: 'Review identity documents' },
  { key: 'kyc.read', description: 'View identity document metadata' },

  { key: 'finance.read', description: 'View financial records' },
  { key: 'finance.payout', description: 'Approve a payout' },
  { key: 'finance.adjust', description: 'Post a ledger adjustment' },

  { key: 'ads.manage_own', description: 'Manage one’s own campaigns' },
  { key: 'ads.review', description: 'Review advertising creatives' },
  { key: 'ads.manage_all', description: 'Manage any campaign' },

  { key: 'surveys.create', description: 'Create a survey or poll' },
  { key: 'surveys.respond', description: 'Respond to a survey or poll' },
  { key: 'surveys.review', description: 'Review survey responses' },

  { key: 'rewards.earn', description: 'Earn reward coins' },
  { key: 'rewards.review', description: 'Review reward eligibility' },

  { key: 'assignments.create', description: 'Post an assignment' },
  { key: 'assignments.apply', description: 'Apply for an assignment' },

  { key: 'security.read', description: 'View security events' },
  { key: 'security.act', description: 'Block accounts and revoke sessions' },

  { key: 'ai.configure', description: 'Configure the AI pipeline' },
  { key: 'audit.read', description: 'Read the audit log' },
]

/** Everything a reader can do. The base every account-holder gets. */
const READER_PERMISSIONS = ['news.read', 'surveys.respond', 'rewards.earn']

export const ROLES: RoleDefinition[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super administrator',
    description: 'Every permission. Held by as few people as possible.',
    privileged: true,
    permissions: PERMISSIONS.map((p) => p.key),
  },
  {
    key: 'ADMIN',
    name: 'Administrator',
    description: 'Platform administration, excluding finance and identity documents.',
    privileged: true,
    permissions: [
      ...READER_PERMISSIONS,
      'news.review', 'news.publish', 'news.unpublish', 'news.correct',
      'users.read', 'users.suspend', 'ads.review', 'surveys.review',
      'rewards.review', 'security.read', 'audit.read',
    ],
  },
  {
    key: 'EDITOR',
    name: 'Editor',
    description: 'Moves stories through review and publishes them.',
    privileged: true,
    permissions: [
      ...READER_PERMISSIONS,
      'news.edit', 'news.review', 'news.publish', 'news.unpublish', 'news.correct',
    ],
  },
  {
    key: 'NEWS_ADMIN',
    name: 'News administrator',
    description: 'Owns the newsroom queues and editorial configuration.',
    privileged: true,
    permissions: [
      ...READER_PERMISSIONS,
      'news.edit', 'news.review', 'news.publish', 'news.unpublish', 'news.correct', 'audit.read',
    ],
  },
  {
    key: 'KYC_ADMIN',
    name: 'KYC administrator',
    description: 'The only role that may read identity documents.',
    privileged: true,
    permissions: [...READER_PERMISSIONS, 'kyc.read', 'kyc.review', 'users.read', 'audit.read'],
  },
  {
    key: 'FINANCE_ADMIN',
    name: 'Finance administrator',
    description: 'Payouts, adjustments and reconciliation. Step-up authentication required.',
    privileged: true,
    permissions: [
      ...READER_PERMISSIONS,
      'finance.read', 'finance.payout', 'finance.adjust', 'users.read', 'audit.read',
    ],
  },
  {
    key: 'AD_ADMIN',
    name: 'Advertising administrator',
    description: 'Reviews creatives and manages any campaign.',
    privileged: true,
    permissions: [...READER_PERMISSIONS, 'ads.review', 'ads.manage_all', 'audit.read'],
  },
  {
    key: 'SURVEY_ADMIN',
    name: 'Survey administrator',
    description: 'Owns survey configuration and response review.',
    privileged: true,
    permissions: [...READER_PERMISSIONS, 'surveys.create', 'surveys.review', 'audit.read'],
  },
  {
    key: 'REWARD_ADMIN',
    name: 'Reward administrator',
    description: 'Reviews reward eligibility and reversals.',
    privileged: true,
    permissions: [...READER_PERMISSIONS, 'rewards.review', 'audit.read'],
  },
  {
    key: 'SECURITY_ADMIN',
    name: 'Security administrator',
    description: 'Investigates abuse, blocks accounts, revokes sessions.',
    privileged: true,
    permissions: [...READER_PERMISSIONS, 'security.read', 'security.act', 'users.read', 'users.suspend', 'audit.read'],
  },
  {
    key: 'AI_ADMIN',
    name: 'AI administrator',
    description: 'Configures the AI pipeline. Cannot publish on its behalf (D-007).',
    privileged: true,
    permissions: [...READER_PERMISSIONS, 'ai.configure', 'audit.read'],
  },

  {
    key: 'VERIFIED_REPORTER',
    name: 'Verified reporter',
    description: 'A reporter whose identity has been verified.',
    privileged: false,
    permissions: [...READER_PERMISSIONS, 'news.submit', 'news.edit', 'assignments.apply'],
  },
  {
    key: 'REPORTER',
    name: 'Reporter',
    description: 'Files stories; verification pending.',
    privileged: false,
    permissions: [...READER_PERMISSIONS, 'news.submit', 'assignments.apply'],
  },
  {
    key: 'CITIZEN_CONTRIBUTOR',
    name: 'Citizen contributor',
    description: 'Submits reports. Nothing publishes without review (§43).',
    privileged: false,
    permissions: [...READER_PERMISSIONS, 'news.submit'],
  },
  {
    key: 'CREATOR',
    name: 'Creator',
    description: 'Publishes video and creator content.',
    privileged: false,
    permissions: [...READER_PERMISSIONS, 'news.submit'],
  },

  {
    key: 'READER',
    name: 'Reader',
    description: 'A registered reader.',
    privileged: false,
    permissions: READER_PERMISSIONS,
  },
  {
    key: 'VIEWER',
    name: 'Viewer',
    description: 'Consumption only.',
    privileged: false,
    permissions: ['news.read'],
  },

  {
    key: 'ADVERTISER',
    name: 'Advertiser',
    description: 'Runs their own campaigns.',
    privileged: false,
    permissions: [...READER_PERMISSIONS, 'ads.manage_own'],
  },
  {
    key: 'BUSINESS',
    name: 'Business',
    description: 'Maintains a business profile and runs campaigns.',
    privileged: false,
    permissions: [...READER_PERMISSIONS, 'ads.manage_own'],
  },
  {
    key: 'ASSIGNMENT_PROVIDER',
    name: 'Assignment provider',
    description: 'Posts assignments for reporters.',
    privileged: false,
    permissions: [...READER_PERMISSIONS, 'assignments.create'],
  },
  {
    key: 'RESEARCH_CLIENT',
    name: 'Research client',
    description: 'Commissions surveys and polls.',
    privileged: false,
    permissions: [...READER_PERMISSIONS, 'surveys.create'],
  },
  {
    key: 'CLIENT',
    name: 'Client',
    description: 'Commissions interviews, stories and biographies.',
    privileged: false,
    permissions: [...READER_PERMISSIONS, 'assignments.create'],
  },
]

const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key))

/**
 * Every permission a role grants must exist in the catalogue. Checked at
 * module load so a typo is a startup failure rather than a silent
 * authorization hole -- a permission that does not exist is one no check can
 * ever match, which reads as "denied" until the day someone adds the real
 * permission and the role quietly gains it.
 */
for (const role of ROLES) {
  for (const permission of role.permissions) {
    if (!PERMISSION_KEYS.has(permission)) {
      throw new Error(`Role ${role.key} references unknown permission ${permission}`)
    }
  }
}
