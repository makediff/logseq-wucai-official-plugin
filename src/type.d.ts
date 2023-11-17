
interface HighlightInfo {
    note: string
    imageUrl: string
    updateAt: number
    annonation: string
    color: string
    slotId: number
}

interface ExportConfig {
    logseqSplitTemplate: string
    logseqPageAddToJournals: number
    logseqPageNoteAsAttr: number
    logseqAnnoAsAttr: number
    logseqQuery: string
}

interface ExportInitRequestResponse {
    lastCursor2: string
    totalNotes: number
    notesExported: number
    taskStatus: string
    exportConfig: ExportConfig
}

interface NoteEntry {
    noteIdX: string
    noteId: number
    author: string
    title: string
    url: string
    wucaiurl: string
    readurl: string
    createAt: number
    updateAt: number
    pageNote: string
    isStar: boolean
    tags: Array<string>
    highlights: Array<HighlightInfo>
    citekey: string
}

interface ExportDownloadResponse {
    notes: Array<NoteEntry>
    lastCursor2: string
}

interface ResponseCheckRet {
    isOk: boolean
    msg: string
    errCode: number
}