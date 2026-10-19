import type * as Sdk from '@anthropic-ai/claude-agent-sdk'

export type SdkModule = Pick<typeof Sdk, 'query' | 'getSessionMessages' | 'getSessionInfo' | 'renameSession' | 'deleteSession'>

let sdk: Promise<SdkModule> | undefined

/** The real SDK, or the scripted fake when ORC_FAKE_SDK points at a fixtures directory. */
export function loadSdk(): Promise<SdkModule> {
  return (sdk ??= process.env.ORC_FAKE_SDK
    ? import('../fake/fake-sdk').then((m) => m.createFakeSdk(process.env.ORC_FAKE_SDK!))
    : import('@anthropic-ai/claude-agent-sdk'))
}
