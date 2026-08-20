export default function IssueReportLoading() {
  return (
    <main
      aria-label="Loading issue report"
      className="min-h-dvh bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-7xl animate-pulse motion-reduce:animate-none">
        <div className="mb-8 h-28 max-w-2xl rounded-xl bg-slate-900" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="h-[36rem] rounded-xl border border-slate-800 bg-slate-900/70" />
          <div className="h-80 rounded-xl border border-slate-800 bg-slate-900/70" />
        </div>
      </div>
    </main>
  )
}
