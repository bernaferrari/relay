import {
  commandPath as path,
  mappedOperation as mapped,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";

export const laneCommandDescriptors: readonly MappedOperationDescriptor[] = [
  mapped(
    "lane.list",
    path("device lane list", [], undefined, {
      summary: "List saved Lanes (who + where a Test, Plan, or preview runs)",
      examples: ["relay device lane list --json"],
    }),
  ),
  mapped(
    "lane.save",
    path("device lane save", ["id"], undefined, {
      summary: "Save a named Lane; credentials stay in the account fixture",
      argumentHelp: [{ name: "id", type: "string", description: "Lane identifier" }],
      inputHelp: [
        { name: "appMapId", type: "string", required: true, description: "App Map identifier" },
        {
          name: "target",
          type: "object",
          required: true,
          description: '{kind:"browser",browserTargetId} or {kind:"device",serial,platform}',
        },
        { name: "targetProfileId", type: "string", description: "Saved runtime profile" },
        { name: "engine", type: "chromium | firefox | webkit", description: "Paired with account" },
        {
          name: "account",
          type: "object",
          description: 'Fixture ids only, or {kind:"signed-out",attested:true}',
        },
        { name: "actorId", type: "string", description: "Actor that owns runs on this Lane" },
      ],
      examples: [
        'relay device lane save daily --input \'{"appMapId":"shop-web","target":{"kind":"browser","browserTargetId":"shop-browser"},"targetProfileId":"browser:shop-browser","actorId":"human:local-cli"}\'',
        'relay device lane save daily-b --input \'{"appMapId":"shop-web","target":{"kind":"browser","browserTargetId":"shop-browser"},"targetProfileId":"browser:shop-browser","actorId":"human:local-cli"}\'',
        'relay device lane save daily-c --input \'{"appMapId":"shop-web","target":{"kind":"browser","browserTargetId":"shop-browser"},"targetProfileId":"browser:shop-browser","actorId":"human:local-cli"}\'',
        'relay device lane save daily-d --input \'{"appMapId":"shop-web","target":{"kind":"browser","browserTargetId":"shop-browser"},"targetProfileId":"browser:shop-browser","actorId":"human:local-cli"}\'',
        'relay device lane save daily-e --input \'{"appMapId":"shop-web","target":{"kind":"browser","browserTargetId":"shop-browser"},"targetProfileId":"browser:shop-browser","actorId":"human:local-cli"}\'',
        'relay device lane save daily-f --input \'{"appMapId":"shop-web","target":{"kind":"browser","browserTargetId":"shop-browser"},"targetProfileId":"browser:shop-browser","actorId":"human:local-cli"}\'',
        'relay device lane save daily-g --input \'{"appMapId":"shop-web","target":{"kind":"browser","browserTargetId":"shop-browser"},"targetProfileId":"browser:shop-browser","actorId":"human:local-cli"}\'',
        'relay device lane save daily-h --input \'{"appMapId":"shop-web","target":{"kind":"browser","browserTargetId":"shop-browser"},"targetProfileId":"browser:shop-browser","actorId":"human:local-cli"}\'',
        'relay device lane save auth-email --input \'{"appMapId":"shop-web","target":{"kind":"browser","browserTargetId":"shop-browser"},"targetProfileId":"browser:shop-browser","actorId":"human:local-cli"}\'',
        'relay device lane save auth-gmail --input \'{"appMapId":"shop-web","target":{"kind":"browser","browserTargetId":"shop-browser"},"targetProfileId":"browser:shop-browser","actorId":"human:local-cli"}\'',
        'relay device lane save auth-x --input \'{"appMapId":"shop-web","target":{"kind":"browser","browserTargetId":"shop-browser"},"targetProfileId":"browser:shop-browser","actorId":"human:local-cli"}\'',
        'relay device lane save auth-x-out --input \'{"appMapId":"shop-web","target":{"kind":"browser","browserTargetId":"shop-browser"},"targetProfileId":"browser:shop-browser","actorId":"human:local-cli"}\'',
        'relay device lane save lab --input \'{"appMapId":"shop-web","target":{"kind":"browser","browserTargetId":"shop-browser"},"targetProfileId":"browser:shop-browser-1280x800-339a5a430a41","engine":"chromium","account":{"kind":"fixture","accountId":"7189423f-193e-45ed-b674-154505cc5107","accountRevision":"1","reference":"authfx:7189423f-193e-45ed-b674-154505cc5107:1"},"actorId":"human:hourly-heavy"}\'',
      ],
      note: "A fixture Lane must bind a unique runtime profile. It never writes authenticationFixtureId onto the saved browser environment. auth-* Lanes isolate headed Chrome user-data; they do not persist a fixture onto shop-browser.",
    }),
  ),
  mapped(
    "lane.remove",
    path("device lane remove", ["laneId"], undefined, {
      summary: "Remove a saved Lane",
      argumentHelp: [{ name: "laneId", type: "string", description: "Lane identifier" }],
      examples: ["relay device lane remove lab"],
    }),
  ),
];
