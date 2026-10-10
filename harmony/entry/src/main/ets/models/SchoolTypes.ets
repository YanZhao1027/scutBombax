export type Campus = 'DXC' | 'GZIC';
export type LoginType = 'card' | 'sno';

export interface SchoolCaptcha {
  key: string;
  image: string;
}
export interface KeyboardData {
  uuid: string;
  numberKeyboard: string;
  lowerLetterKeyboard: string;
  upperLetterKeyboard: string;
  symbolKeyboard: string;
}
export interface KeyboardEnvelope {
  code: number;
  success: boolean;
  data: KeyboardData;
}
export interface FrontInfoData {
  platType: string;
}
export interface FrontInfo {
  code: number;
  success: boolean;
  data: FrontInfoData;
}
export interface LoginReply {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  code?: number;
  message?: string;
  msg?: string;
}
export interface GzicRoom {
  room: string;
}
export interface GzicShowData {
  信息: string;
}
export interface GzicMap {
  data: GzicRoom;
  showData: GzicShowData;
}
export interface GzicItem {
  code: number;
  map: GzicMap;
}
export interface DxcResult {
  roomName?: string;
  leftMoney?: number | string;
}
export interface DxcReply {
  statusCode: string | number;
  message?: string;
  resultObject: DxcResult;
}
export interface BalanceReading {
  campus: Campus;
  room: string;
  electric: number;
  water: number;
  ac: number | null;
  electricText: string;
  waterText: string;
  acText: string;
  at: number;
}
export interface HistoryPoint {
  at: number;
  campus: Campus;
  electric: number;
  water: number;
  ac: number | null;
}
export class ProtocolFailure extends Error {
  stage: string;
  publicReason: string;
  constructor(stage: string, publicReason: string) {
    super(publicReason);
    this.stage = stage;
    this.publicReason = publicReason;
  }
}
