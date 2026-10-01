// Spec §4: Data Model – Core domain types for Ukoo Yetu

export type DatePrecision = 'year' | 'month' | 'day';

export interface FuzzyDate {
  year: number;
  month?: number;
  day?: number;
  precision: DatePrecision;
}

export type Sex = 'male' | 'female' | 'other';

export type PrivacyClass = 'living_private' | 'living_family' | 'deceased_family' | 'deceased_public';

export type DeathState = 'living' | 'reported' | 'verified' | 'disputed';

export type ParentageKind = 'biological' | 'adoptive' | 'foster' | 'step';

export type ParentageCertainty = 'presumed' | 'documented' | 'verified';

export type UnionKind = 'marriage' | 'partnership' | 'cohabitation';

export type BioMode = 'closed' | 'private' | 'family' | 'public';

export type KycLevel = 0 | 1 | 2 | 3;

export type MediaClass = 'photo' | 'audio' | 'video' | 'document' | 'other';

export type MediaState = 'uploading' | 'scanning' | 'ready' | 'rejected';

export type SpaceRole = 'custodian' | 'member' | 'guest';

export interface Person {
  id: string;
  displayName: string;
  sex: Sex;
  birthFuzzy: FuzzyDate | null;
  deathFuzzy: FuzzyDate | null;
  deathState: DeathState;
  privacy: PrivacyClass;
  spaceId: string;
  kycLevel: KycLevel;
  claimedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Parentage {
  childId: string;
  parentId: string;
  kind: ParentageKind;
  certainty: ParentageCertainty;
  evidenceSourceId?: string;
  createdAt: Date;
}

export interface UnionRel {
  id: string;
  kind: UnionKind;
  startedFuzzy: FuzzyDate | null;
  endedFuzzy: FuzzyDate | null;
  spaceId: string;
  createdAt: Date;
}

export interface UnionPartner {
  unionId: string;
  personId: string;
  seniority: number;
}

export interface PersonGrant {
  personId: string;
  userId: string;
  scope: 'subject' | 'custodian' | 'editor';
  grantedAt: Date;
}

export interface AncestryClosureEdge {
  descendantId: string;
  ancestorId: string;
  distance: number;
  path: string[];
}

export interface RelationshipLabel {
  ancestorId: string;
  descendantId: string;
  label: string;
  certainty: ParentageCertainty;
}

export type ConsentPurpose =
  | 'profile'
  | 'photo'
  | 'clan_field'
  | 'kitabu_link'
  | 'public_memorial'
  | 'program_membership'
  | 'program_contact'
  | 'welfare_eligibility';

export interface RelationshipInfo {
  label: string;
  certainty: ParentageCertainty;
  evidenceCount: number;
}
