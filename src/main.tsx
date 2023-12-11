import '@logseq/libs'
import 'virtual:windi.css'

import React from 'react'
import App from './App'
import { BGCONSTS } from './bgconsts'
import { format } from 'date-fns'
import { IBatchBlock, PageEntity, SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin'
import { createRoot } from 'react-dom/client'
import { BlockEntity, BlockUUID, PageIdentity } from '@logseq/libs/dist/LSPlugin.user'
import { WuCaiUtils } from './utils'
import Mustache from 'Mustache'

// @ts-expect-error
const css = (t, ...args) => String.raw(t, ...args)
const TriggerIconName = 'wucai-icon'
const STATUS_SUCCESS = ['SYNCING']
const API_URL_INIT = '/apix/openapi/wucai/sync/init'
const API_URL_DOWNLOAD = '/apix/openapi/wucai/sync/download'
const API_URL_ACK = '/apix/openapi/wucai/sync/ack'

function getAuthHeaders() {
  const tk = logseq.settings?.wuCaiToken || ''
  return {
    AUTHORIZATION: `Token ${tk}`,
    'Logseq-Client': `${getLogseqClientID()}`,
  }
}

function callApi(url: string, params: any) {
  const reqtime = Math.floor(+new Date() / 1000)
  params['v'] = BGCONSTS.VERSION_NUM
  params['serviceId'] = BGCONSTS.SERVICE_ID
  url += `?appid=${BGCONSTS.APPID}&ep=${BGCONSTS.ENDPOINT}&version=${BGCONSTS.VERSION}&reqtime=${reqtime}`
  return fetch(BGCONSTS.BASE_URL + url, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    method: 'POST',
    body: JSON.stringify(params),
  })
}

function getLogseqClientID() {
  let cid = window.localStorage.getItem(BGCONSTS.CLIENT_ID_KEY)
  if (cid) {
    return cid
  }
  cid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  window.localStorage.setItem(BGCONSTS.CLIENT_ID_KEY, cid)
  return cid
}

// @ts-ignore
export async function getUserAuthToken(attempt = 0) {
  const uuid = getLogseqClientID()
  if (attempt === 0) {
    window.open(`${BGCONSTS.BASE_URL}/page/gentoken/${BGCONSTS.SERVICE_ID}/${uuid}`)
  }
  await new Promise((r) => setTimeout(r, 2000)) // wait until have data on cache
  let response, data
  try {
    let url = '/page/auth/openapi/gettoken'
    response = await callApi(url, { did: uuid })
  } catch (e) {
    logger(['WuCai Official plugin: fetch failed in getUserAuthToken: ', e])
  }
  if (response && response.ok) {
    data = await response.json()
  } else {
    logger(['WuCai Official plugin: bad response in getUserAuthToken: ', response])
    logseq.UI.showMsg('Authorization failed. Try again', 'warning')
    return
  }
  if (data.code === 1 && data.data.accessToken) {
    return data.data.accessToken
  }
  if (attempt > 20) {
    logger('WuCai Official plugin: reached attempt limit in getUserAuthToken')
    return
  }
  logger(`WuCai Official plugin: didn't get token data, retrying (attempt ${attempt + 1})`)
  await new Promise((r) => setTimeout(r, 1000))
  return await getUserAuthToken(attempt + 1)
}

function formatDate(ts: number, preferredDateFormat: string): string {
  return format(new Date(ts * 1000), preferredDateFormat)
}

function getNewEntryBlock(
  entry: NoteEntry,
  preferredDateFormat: string,
  exportConfig: ExportConfig,
  parsedTemplate: WuCaiTemplates
) {
  const tags = (entry.tags || []).join(' ')
  const createat = `${formatDate(entry.createAt, 'yyyy-MM-dd HH:mm')}`
  const updateat = `${formatDate(entry.updateAt, 'yyyy-MM-dd HH:mm')}`
  const view = {
    noteid: entry.noteIdX,
    tags,
    createat,
    updateat,
    url: entry.url || '',
    wucaiurl: entry.wucaiurl || '',
    pagenote: entry.pageNote || '',
  }
  let properties: { [key: string]: any } = {
    noteid: entry.noteIdX,
  }
  if (exportConfig.logseqPageNoteAsAttr === 1) {
    properties["note"] = entry.pageNote || ''
  }
  if (exportConfig.logseqPageAddToJournals === 1) {
    properties["date"] = `[[${formatDate(entry.createAt, preferredDateFormat)}]]`
  }
  if (parsedTemplate.AttrTemplate) {
    for (let attr of parsedTemplate.AttrTemplate) {
      let tmpvalue: any = attr.value
      if (attr.render) {
        tmpvalue = WuCaiUtils.renderTemplate(attr.value, view)
      }
      if (!tmpvalue) {
        continue
      }
      if (['true', 'false'].indexOf(tmpvalue) >= 0) {
        tmpvalue = tmpvalue === 'true'
      } else if (/^\d+$/.test(tmpvalue)) {
        tmpvalue = parseInt(tmpvalue)
      }
      properties[attr.name] = tmpvalue
    }
  }
  let title
  if (parsedTemplate.TitleTemplate && parsedTemplate.TitleTemplate.render) {
    const titleView = {
      title: WuCaiUtils.formatTitle(entry.title),
      url: entry.url,
      wucaiurl: entry.wucaiurl,
    }
    title = WuCaiUtils.renderTemplate(parsedTemplate.TitleTemplate.value, titleView)
  } else {
    title = WuCaiUtils.formatTitle(entry.title)
  }
  return {
    title: title || 'No title',
    properties,
  }
}

function handleSyncError(cb: () => void) {
  logseq.updateSettings({
    lastSyncFailed: true,
  })
  cb()
}

export function clearSettingsComplete() {
  logseq.updateSettings({
    lastSyncFailed: false,
    lastCursor: '',
    wuCaiToken: null,
    isLoadAuto: true,
    currentGraph: null,
  })
}

// 对接口返回的内容进行检查
function checkResponseBody(rsp: any, setAccessToken?: any): ResponseCheckRet {
  let ret: ResponseCheckRet = { isOk: true, msg: '', errCode: 1 }
  if (!rsp) {
    ret.isOk = false
    ret.msg = 'WuCai: call api failed'
    return ret
  }
  if (rsp && 1 === rsp.code) {
    ret.isOk = true
    ret.msg = ''
    return ret
  }
  let errCode = rsp.code
  ret.isOk = false
  ret.errCode = rsp.code
  if (10000 === errCode || 10100 === errCode || 10101 === errCode) {
    logseq.updateSettings({ wuCaiToken: '' })
    setAccessToken && setAccessToken('')
  }
  let err = localize(rsp['message'] || 'call api failed')
  err = `WuCai: ${errCode} ${err}`
  ret.msg = err
  return ret
}

function getErrorMessageFromResponse(response: Response) {
  if (response && response.status === 409) {
    return 'Sync in progress initiated by different client'
  }
  if (response && response.status === 417) {
    return 'Obsidian export is locked. Wait for an hour.'
  }
  return `${response ? response.statusText : "Can't connect to server"}`
}

// 获取划线所在的block
async function getHighlightBlockBy(parentBlockId: string, highlight: string): Promise<BlockEntity | undefined> {
  // 23.6.21 如果 block 产生了 ref，会改变 content，所以需要用 includes 来判断
  const blocks = (
    await logseq.DB.datascriptQuery<BlockEntity[]>(
      `[:find (pull ?b [*])
        :where
          [?b :block/parent ?parent]
          [?parent :block/uuid ?u]
          [(str ?u) ?s]
          [(= ?s "${parentBlockId}")]
          [?b :block/content ?c]
          [(clojure.string/includes? ?c "${WuCaiUtils.escapeQuotes(highlight)}")]
      ]`
    )
  ).flat()
  return blocks[0]
}

// 找出页面所在的block
async function getWebPageBlockByNoteIdX(pageName: string, noteIdX: string): Promise<BlockEntity | null> {
  const blocks = (
    await logseq.DB.datascriptQuery<BlockEntity[]>(
      `[:find (pull ?b [*])
        :where
          [?b :block/page ?p]
          [?p :block/original-name "${WuCaiUtils.escapeQuotes(pageName)}"]
          [?b :block/properties ?prop]
          [(get ?prop :noteid) ?noteid]
          [(= ?noteid "${WuCaiUtils.escapeQuotes(noteIdX)}")]]`
    )
  ).flat()
  return blocks[0] || null
}

function handleSyncSuccess(msg = 'Synced', lastCursor: string = '') {
  logseq.updateSettings({
    lastSyncFailed: false,
  })
  if (lastCursor) {
    logseq.updateSettings({ lastCursor })
  }
  if (msg && msg.length > 0) {
    logseq.UI.showMsg(msg)
  }
}

function getLastCursor(newCursor: string, savedCursor: string): string {
  return newCursor || savedCursor || ''
}

// @ts-ignore
export async function exportInit(auto?: boolean, setNotification?, setIsSyncing?, setAccessToken?) {
  setNotification = setNotification || function (x: any) { }
  // @ts-ignore
  if (window.onAnotherGraph) {
    setIsSyncing(false)
    setNotification(null)
    handleSyncError(() => {
      const msg = `Graph changed during sync, please return to graph "${logseq.settings!.currentGraph.name}" to complete the sync`
      if (!auto) {
        logseq.UI.showMsg(msg, 'error')
      } else {
        logger(msg)
      }
    })
    return
  }

  setNotification('Starting wuCai sync...')

  if (auto) {
    await new Promise((r) => setTimeout(r, 2000))
  }

  // @todo 因为有了网页拆分规则，就无法通过单个文件来判断是否需要重新同步，需要有新的机制
  const noteDirDeleted = false
  // const noteDirDeleted = (await logseq.Editor.getPage(BGCONSTS.ROOT_PAGE_NAME)) === null
  let lastCursor2 = logseq.settings?.lastCursor || ''
  let response
  let errmsg = ''
  try {
    // if (noteDirDeleted) {
    //   lastCursor2 = ''
    // }
    response = await callApi(API_URL_INIT, { noteDirDeleted, lastCursor2 })
  } catch (e) {
    errmsg = 'req export init error'
    logger({ errmsg, e })
  }
  if (!response || !response.ok) {
    setIsSyncing(false)
    setNotification(errmsg)
    logseq.UI.showMsg(errmsg, 'error')
    return
  }

  const data2 = await response.json()
  const checkRet: ResponseCheckRet = checkResponseBody(data2, setAccessToken)
  if (!checkRet.isOk) {
    setIsSyncing(false)
    setNotification(checkRet.msg)
    logseq.UI.showMsg(checkRet.msg, 'error')
    return
  }

  const initRet: ExportInitRequestResponse = data2['data']
  logger({ initRet, msg: "init rsp" })
  const lastCursor = getLastCursor(initRet.lastCursor2, lastCursor2)
  if (lastCursor) {
    logseq.updateSettings({ lastCursor })
  }

  if (!STATUS_SUCCESS.includes(initRet.taskStatus)) {
    handleSyncSuccess()
    logseq.UI.showMsg('WuCai data is already up to date')
    setIsSyncing(false)
    setNotification(null)
    return
  }

  // init values
  let {
    logseqSplitTemplate,
    logseqPageAddToJournals,
    logseqPageNoteAsAttr,
    logseqAnnoAsAttr,
    logseqQuery,
    lsqtt,
    lsqat,
    lsqht,
    lsqant,
  } = initRet.exportConfig || {}
  const tmpConfig: ExportConfig = {
    logseqSplitTemplate: logseqSplitTemplate || "note",
    logseqPageAddToJournals: logseqPageAddToJournals || 1,
    logseqPageNoteAsAttr: logseqPageNoteAsAttr || 2,
    logseqAnnoAsAttr: logseqAnnoAsAttr || 2,
    logseqQuery: logseqQuery || '',
    lsqtt: lsqtt || '{{title}}',
    lsqat: lsqat || `collapsed:: true`,
    lsqht: lsqht || '{{note}}',
    lsqant: lsqant || '{{anno}}',
  }
  const df = (await logseq.App.getUserConfigs()).preferredDateFormat
  const parsedTemplate: WuCaiTemplates = {
    TitleTemplate: { name: '', value: tmpConfig.lsqtt, render: false, },
    AttrTemplate: WuCaiUtils.parserAttrTemplate(tmpConfig.lsqat),
    HighlightTemplate: { name: '', value: tmpConfig.lsqht, render: false },
    AnnoTemplate: { name: '', value: tmpConfig.lsqant, render: false }
  }
  const { message } = WuCaiUtils.preParserTemplate(parsedTemplate)
  if (message) {
    logseq.UI.showMsg(message)
    setIsSyncing(false)
    setNotification(null)
    return
  }
  await downloadArchive(lastCursor, df, tmpConfig, parsedTemplate, setNotification, setIsSyncing, setAccessToken)
}

// @ts-ignore
async function downloadArchive(
  lastCursor2: string,
  preferredDateFormat: string,
  exportConfig: ExportConfig,
  parsedTemplate: WuCaiTemplates,
  setNotification?: any,
  setIsSyncing?: any,
  setAccessToken?: any
): Promise<void> {
  let response
  let flagx = ''
  const writeStyle = 1
  let noteIdXs: Array<string> = []
  try {
    response = await callApi(API_URL_DOWNLOAD, {
      lastCursor2,
      noteIdXs,
      flagx,
      writeStyle,
      out: BGCONSTS.OUT,
      checkUpdate: false,
      q: exportConfig.logseqQuery || '',
    })
  } catch (e) {
    logger(['fetch failed in downloadArchive: ', e])
    setIsSyncing(false)
  }
  if (!response || !response.ok) {
    setIsSyncing(false)
    setNotification('request download api error 1')
    logger({ msg: 'req download api error 1', response })
    logseq.UI.showMsg(getErrorMessageFromResponse(response as Response), 'error')
    return
  }

  const data2 = await response.json()
  const checkRet: ResponseCheckRet = checkResponseBody(data2, setAccessToken)
  if (!checkRet.isOk) {
    setIsSyncing(false)
    setNotification('request download api error 2')
    logger({ msg: 'req download api error 2', checkRet })
    logseq.UI.showMsg(checkRet.msg, 'error')
    return
  }

  const downloadRet: ExportDownloadResponse = data2['data']
  const entries: Array<NoteEntry> = downloadRet.notes || []

  // 对网页所在的节点UUID进行缓存，以提升性能
  const cachedPageUUID = {}
  for (const entry of entries) {
    try {
      let parentName = WuCaiUtils.generatePageName(exportConfig.logseqSplitTemplate, entry.createAt)
      let parentUUID = cachedPageUUID[parentName] || ''
      if (!parentUUID) {
        let tmpPage = await logseq.Editor.getPage(parentName)
        if (!tmpPage) {
          tmpPage = await logseq.Editor.createPage(parentName)
          if (!tmpPage) {
            continue
          }
        }
        parentUUID = tmpPage.uuid
        cachedPageUUID[parentName] = parentUUID
        logger({ msg: 'create new node', parentName, parentUUID })
      } else {
        logger({ msg: 'use cache node', parentName, parentUUID })
      }
      const noteIdX = entry.noteIdX
      let webpageBlock = await getWebPageBlockByNoteIdX(parentName, noteIdX)
      const { title, properties } = getNewEntryBlock(entry, preferredDateFormat, exportConfig, parsedTemplate)
      if (!title) {
        continue
      }
      logger({ msg: "new block", title, properties, })
      if (!webpageBlock) {
        webpageBlock = await logseq.Editor.insertBlock(parentUUID, title, {
          sibling: false,
          properties,
        })
        if (!webpageBlock) {
          logger({ msg: 'create page failed', title, properties })
          continue
        }
      } else {
        let updateProps = Object.keys(properties || {})
        for (let name of updateProps) {
          await logseq.Editor.upsertBlockProperty(webpageBlock.uuid, name, properties[name])
        }
      }
      if (entry.pageNote) {
        const isPageNoteAsAttr = exportConfig.logseqPageNoteAsAttr === 1
        if (!isPageNoteAsAttr) {
          const pageNoteCore = WuCaiUtils.formatContent(entry.pageNote)
          entry.highlights.unshift({
            note: pageNoteCore,
          } as HighlightInfo)
        }
      }
      entry.highlights = entry.highlights || []
      const highParentUUID = webpageBlock.uuid
      const isAnnoAsAttr = exportConfig.logseqAnnoAsAttr === 1
      for (const light of entry.highlights) {
        let noteCore
        if (light.imageUrl) {
          noteCore = `![](${light.imageUrl})`
        } else {
          const view = {
            "refid": light.refid || '',
            "refurl": WuCaiUtils.getHighlightUrl(entry.url, light.refurl),
            "note": WuCaiUtils.formatContent(light.note),
            "slotid": light.slotId || 1,
            "color": light.color || '',
          }
          noteCore = WuCaiUtils.renderTemplate(parsedTemplate.HighlightTemplate.value, view)
        }
        let highBlock = await getHighlightBlockBy(highParentUUID, noteCore)
        if (!highBlock) {
          highBlock = (await logseq.Editor.insertBlock(highParentUUID, noteCore, { sibling: false })) || undefined
          if (!highBlock) {
            continue
          }
        }
        if (light.annonation) {
          const annoCore = WuCaiUtils.formatContent(light.annonation)
          if (isAnnoAsAttr) {
            highBlock.properties = highBlock.properties || {}
            const oldNoteProp = highBlock.properties['note']
            if (oldNoteProp != annoCore) {
              await logseq.Editor.upsertBlockProperty(highBlock.uuid, 'note', annoCore)
            }
          } else {
            let annoBlock = await getHighlightBlockBy(highBlock.uuid, annoCore)
            if (!annoBlock) {
              await logseq.Editor.insertBlock(highBlock.uuid, annoCore)
            }
          }
        }
      }
    } catch (e2) {
      logger({ msg: 'process entry error', entry, e2 })
      setNotification && setNotification('process highlight error')
    }
  }

  const isCompleted = entries.length <= 0 || BGCONSTS.IS_DEBUG
  const tmpLastCursor2 = getLastCursor(downloadRet.lastCursor2, lastCursor2)
  if (!tmpLastCursor2 || lastCursor2 == tmpLastCursor2) {
    setNotification && setNotification(null)
    logseq.UI.showMsg('WuCai Hightlights sync completed')
    return
  }

  lastCursor2 = tmpLastCursor2
  logseq.updateSettings({ lastCursor: lastCursor2 })

  if (isCompleted) {
    setIsSyncing && setIsSyncing(false)
    setNotification && setNotification(null)
    handleSyncSuccess('', lastCursor2)
    await acknowledgeSyncCompleted()
    logseq.UI.showMsg('WuCai Hightlights sync completed')
    return
  }

  await new Promise((r) => setTimeout(r, 5000))
  await downloadArchive(
    lastCursor2,
    preferredDateFormat,
    exportConfig,
    parsedTemplate,
    setNotification,
    setIsSyncing,
    setAccessToken
  )
  logger({ msg: 'continue download', lastCursor2 })
}

async function acknowledgeSyncCompleted() {
  try {
    const lastCursor2 = logseq.settings?.lastCursor
    callApi(API_URL_ACK, { lastCursor2 })
  } catch (e) {
    logger({ msg: 'fetch failed to acknowledged sync: ', e })
  }
}

function configureSchedule() {
  checkForCurrentGraph()
  // 23.6.4 引擎同步会引起卡顿，目前暂停自动同步
  // // @ts-ignore
  // const onAnotherGraph = window.onAnotherGraph
  // if (logseq.settings!.wuCaiToken && logseq.settings!.frequency) {
  //   if (logseq.settings!.frequency === 'Never') {
  //     return
  //   }
  //   if (!onAnotherGraph) {
  //     const frequency = parseInt(logseq.settings!.frequency)
  //     if (!isNaN(frequency) && frequency > 0) {
  //       const milliseconds = frequency * 60 * 1000
  //       // eslint-disable-next-line @typescript-eslint/no-empty-function
  //       window.setInterval(
  //         () => exportInit(true, console.log, () => {}).then(() => console.log('Auto sync loaded.')),
  //         milliseconds
  //       )
  //     } else {
  //       logseq.updateSettings({
  //         frequency: '180',
  //       })
  //     }
  //   }
  // }
}

function logger(msg: any) {
  BGCONSTS.IS_DEBUG && console.log(msg)
}

function localize(msg: string): string {
  return msg
}

export function checkForCurrentGraph() {
  window.logseq.App.getCurrentGraph().then((currentGraph) => {
    // @ts-ignore
    window.onAnotherGraph = !!(logseq.settings!.currentGraph && currentGraph?.url !== logseq.settings!.currentGraph.url)
  })
}

function main() {
  const schema: Array<SettingSchemaDesc> = [
    {
      key: 'isLoadAuto',
      type: 'boolean',
      default: false,
      title: 'Sync automatically when Logseq opens',
      description: 'If enabled, WuCai will automatically resync with Logseq each time you open the app',
    },
    {
      key: 'frequency',
      type: 'enum',
      enumChoices: ['Never'],
      enumPicker: 'select',
      default: 'Never',
      title: 'Resync frequency',
      description:
        'WuCai will automatically resync with Logseq when the app is open at the specified interval (in minutes)',
    },
  ]
  logseq.useSettingsSchema(schema)

  const pluginId = logseq.baseInfo.id
  console.info({ msg: 'wucai loaded', pluginId })

  const container = document.getElementById('app')
  const root = createRoot(container!)
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )

  function createModel() {
    return {
      async show() {
        logseq.showMainUI()
      },
    }
  }

  logseq.provideModel(createModel())
  logseq.setMainUIInlineStyle({
    zIndex: 11,
  })

  logseq.provideStyle(css`
    @font-face {
      font-weight: normal;
      font-style: normal;
      font-display: block;
    }

    [class^='wucai-'],
    [class*='wucai-'] {
      speak: never;
      font-style: normal;
      font-weight: normal;
      font-variant: normal;
      text-transform: none;
      line-height: 1;
      -webkit-font-smoothing: antialiased;
    }

    .${TriggerIconName} {
      font-size: 12px;
    }

    .${TriggerIconName} {
      height: 20px;
      width: 20px;
      background: url(data:image/svg+xml;base64,Cjxzdmcgd2lkdGg9IjE4cHgiIGhlaWdodD0iMThweCIgdmlld0JveD0iMCAwIDE4IDE4IiB2ZXJzaW9uPSIxLjEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiPgogICAgPGRlZnM+CiAgICAgICAgPHJlY3QgaWQ9InBhdGgtMTBqZXhodHNkdi0xIiB4PSIwIiB5PSIwIiB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSI0Ij48L3JlY3Q+CiAgICAgICAgPGxpbmVhckdyYWRpZW50IHgxPSIyNS4zOTk0ODUxJSIgeTE9IjE0LjYwMjQzMjklIiB4Mj0iNDQuNzM5MDc2NyUiIHkyPSI3OS41NTgzMzQzJSIgaWQ9ImxpbmVhckdyYWRpZW50LTEwamV4aHRzZHYtMyI+CiAgICAgICAgICAgIDxzdG9wIHN0b3AtY29sb3I9IiNEMkNGOTciIG9mZnNldD0iMCUiPjwvc3RvcD4KICAgICAgICAgICAgPHN0b3Agc3RvcC1jb2xvcj0iI0U4RTA0OCIgb2Zmc2V0PSIxMDAlIj48L3N0b3A+CiAgICAgICAgPC9saW5lYXJHcmFkaWVudD4KICAgICAgICA8cmVjdCBpZD0icGF0aC0xMGpleGh0c2R2LTQiIHg9IjAiIHk9IjAiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgcng9IjQiPjwvcmVjdD4KICAgIDwvZGVmcz4KICAgIDxnIGlkPSJQYWdlLTEiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIiBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIG9wYWNpdHk9IjAuNjcyMjkzNTI3Ij4KICAgICAgICA8ZyBpZD0iaWNvbiI+CiAgICAgICAgICAgIDxtYXNrIGlkPSJtYXNrLTEwamV4aHRzZHYtMiIgZmlsbD0id2hpdGUiPgogICAgICAgICAgICAgICAgPHVzZSB4bGluazpocmVmPSIjcGF0aC0xMGpleGh0c2R2LTEiPjwvdXNlPgogICAgICAgICAgICA8L21hc2s+CiAgICAgICAgICAgIDxnIGlkPSJSZWN0YW5nbGUiPjwvZz4KICAgICAgICAgICAgPG1hc2sgaWQ9Im1hc2stMTBqZXhodHNkdi01IiBmaWxsPSJ3aGl0ZSI+CiAgICAgICAgICAgICAgICA8dXNlIHhsaW5rOmhyZWY9IiNwYXRoLTEwamV4aHRzZHYtNCI+PC91c2U+CiAgICAgICAgICAgIDwvbWFzaz4KICAgICAgICAgICAgPHVzZSBpZD0iUmVjdGFuZ2xlIiBmaWxsPSJ1cmwoI2xpbmVhckdyYWRpZW50LTEwamV4aHRzZHYtMykiIHhsaW5rOmhyZWY9IiNwYXRoLTEwamV4aHRzZHYtNCI+PC91c2U+CiAgICAgICAgICAgIDxnIGlkPSJwZW5jaWwiIG1hc2s9InVybCgjbWFzay0xMGpleGh0c2R2LTUpIiBmaWxsLXJ1bGU9Im5vbnplcm8iPgogICAgICAgICAgICAgICAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMy41Mzc2LCAtMTYuNzUxMykiIGlkPSJTaGFwZSI+CiAgICAgICAgICAgICAgICAgICAgPHBhdGggZD0iTTI2LjE2OTk0NTMsOS45MzgzOTU3NSBDMjQuNDQ0NzgwNiwxMS42NTk5MzE3IDEwLjE2MTI0ODEsMjUuOTE1NjIxMiA4LjMzNTQzMzMsMjcuNzM4MTQyNiBMMy41MTU0MTAxMSwyMi45MjcyNDk0IEM1LjgwMDU0MDk2LDIwLjY0NjgzODcgMTkuODY4MTI4NCw2LjYwNjY3MzQ5IDIxLjM0OTkyMiw1LjEyNzc2ODMxIEwyNi4xNjk5NDUzLDkuOTM4Mzk1NzUgWiIgZmlsbD0iI0NDRjJGRCI+PC9wYXRoPgogICAgICAgICAgICAgICAgICAgIDxwb2x5Z29uIGZpbGw9IiNGQUZBRkEiIHBvaW50cz0iOC4zMzU0MzMzIDI3LjczODE0MjYgNC4xMTc5Nzk1MyAyOS4zMDE1NTY3IDEuOTUzNzM1MzEgMjcuMTQxMjY1NSAzLjUxNTQxMDExIDIyLjkyNzI0OTQiPjwvcG9seWdvbj4KICAgICAgICAgICAgICAgICAgICA8cGF0aCBkPSJNOC45MDQ0NTI3MSwxNi41ODY2OTI1IEwzLjAzMzQ2MSwyMi40NDYyMzk4IEMyLjk2ODIyNDgyLDIyLjUxMTM0ODggMi45MTM5MDU3LDIyLjU5MzIwMDIgMi44NzkwMjQyOCwyMi42ODQ4ODQzIEMyLjMzMzk2OTE2LDI0LjE1NDQ4ODIgMC42ODkyMTgxMjUsMjguNTkzMDY0MSAwLjA0MjE4MTQ5NTYsMzAuMzM5MDQ5MiBDLTAuMDQ5OTQ3OTYwOSwzMC41ODgzMjM4IDAuMDExNTYwNDczMiwzMC44Njg2OTEzIDAuMjAwMDc5Nzc4LDMxLjA1NjMxMTYgQzAuMzg3MDAxNDI3LDMxLjI0Mjg2ODkgMC42Njc2NTAyNTYsMzEuMzA1ODUxOSAwLjkxOTAwOTMyOSwzMS4yMTI4MzkgQzIuNjE0NjE3OTksMzAuNTg0MzM3NSA3LjEwMjMzNTk3LDI4LjkyMDczNTMgOC41NzI2ODAwNywyOC4zNzU2Nzk3IEM4LjY1ODQxOTA0LDI4LjM0NDA1NTMgOC43NDc4ODU4MywyOC4yODg1MTMzIDguODE3MzgyNDEsMjguMjE5MTUyMiBMMTQuNjg3ODQxNSwyMi4zNjAxMzY0IEMxNC41OTk4NTAxLDIyLjQxNzUzODcgMTQuNjE2Mzg2NSwyMi40NDYyMzk4IDE0LjczNzQ1MDcsMjIuNDQ2MjM5OCBDMjMuODkzODk1MiwxMy4yMTcyMzM1IDI5LjAxNzUyNzYsOC4wNTgzODM0NSAzMC4xMDgzNDc5LDYuOTY5Njg5NTQgQzMxLjcwNzAzNDIsNS4zNzU5Nzk4NiAzMS43MDgwOTkzLDIuNzkxMjg0MTIgMzAuMTA4NjE0MiwxLjE5Njc3NzE3IEMyOC41MTA3MjY3LC0wLjM5ODc5Mjg1NCAyNS45MjMzNzkxLC0wLjM5OTA1ODU4OCAyNC4zMjQ0MjY1LDEuMTk2Nzc3MTcgTDE2LjYxNjk2OTIsOC44ODkyMTAxOCBDMTYuNjE2NzkxNiw5LjAxMDAzODQgMTQuMDQ1OTUyOCwxMS41NzU4NjU4IDguOTA0NDUyNzEsMTYuNTg2NjkyNSBaIE0xNy4wOTg5MTgzLDEwLjMzMjUwNDcgQzE3LjA5ODkxODMsMTAuMzMyNTA0NyAxNy4wOTg5MTgzLDEwLjMzMjUwNDcgMTcuMDk5MTg0NSwxMC4zMzIyMzkgQzE3LjA5OTE4NDUsMTAuMzMyMjM5IDE3LjA5OTE4NDUsMTAuMzMyMjM5IDE3LjA5OTE4NDUsMTAuMzMxOTczMiBMMjEuMzQ5OTIyLDYuMDg5Nzg3NDQgTDI1LjIwNTc4MDksOS45MzgzOTU3NSBMMjAuOTU1ODQyMSwxNC4xNzk3ODQyIEMyMC45NTU4NDIxLDE0LjE4MDA1IDIwLjk1NTg0MjEsMTQuMTgwMDUgMjAuOTU1NTc1OSwxNC4xODAwNSBMMjAuOTU1NTc1OSwxNC4xODAzMTU4IEw4LjMzNTQzMzMsMjYuNzc1ODU3NiBMNC40Nzk1NzQ1LDIyLjkyNzI0OTQgTDE3LjA5ODkxODMsMTAuMzMyNTA0NyBaIE00LjI5MDc4ODk0LDI4LjUxMTQ3ODUgTDIuNzQ0ODI0MSwyNi45Njg1MjczIEwzLjc4NTY3NDMxLDI0LjE1OTI3MTggTDcuMTAyMzM1OTcsMjcuNDY5NDY4MiBMNC4yOTA3ODg5NCwyOC41MTE0Nzg1IFogTTIuMjI0MjY1ODMsMjguMzczMjg3OSBMMi44ODQ4ODIyNiwyOS4wMzI2MTY1IEwxLjgzNTc3NzU5LDI5LjQyMTQxMDQgTDIuMjI0MjY1ODMsMjguMzczMjg3OSBaIiBmaWxsPSIjNEQ0QzRDIj48L3BhdGg+CiAgICAgICAgICAgICAgICA8L2c+CiAgICAgICAgICAgIDwvZz4KICAgICAgICA8L2c+CiAgICA8L2c+Cjwvc3ZnPgo=) no-repeat !important;
    }
  `)

  logseq.App.registerUIItem('toolbar', {
    key: 'wucai-plugin-open',
    template: `
          <a data-on-click="show" title="WuCai" class="button">
            <span class="${TriggerIconName}"></span>
          </a>
        `,
  })
  checkForCurrentGraph()
  window.logseq.App.onCurrentGraphChanged(() => {
    checkForCurrentGraph()
  })
  // configureSchedule()
}

logseq.ready(main).catch(console.error)
