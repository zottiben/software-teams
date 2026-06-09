import type { IDataObject } from "n8n-workflow";
import type { NodeEnvelope } from "@websitelabs/software-teams";

/**
 * n8n's INodeExecutionData.json is typed IDataObject, but our domain types
 * (NodeEnvelope, Record<string,unknown>) are structurally compatible. These
 * two helpers centralise the double-cast so call sites stay clean.
 * R-04: only cross this boundary here — never scatter `as unknown as` elsewhere.
 */
export function toDataObject(value: NodeEnvelope | Record<string, unknown>): IDataObject {
  return value as unknown as IDataObject;
}

export function fromDataObject<T>(d: IDataObject): T {
  return d as unknown as T;
}
