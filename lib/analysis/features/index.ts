// Importing each construct file registers its features under their registry ids.
import "./speed";
import "./breakdown";
import "./repair";
import "./interaction";
import "./lexical";
import "./composite";
import "./quality";

export { featureFunctions } from "./define";
export type { FeatureFn, RawValue } from "./define";
