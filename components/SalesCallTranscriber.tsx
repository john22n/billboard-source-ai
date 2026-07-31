'use client'

import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useBillboardFormExtraction } from '@/hooks/useBillboardFormExtraction'
import { useTwilioContext } from '@/components/providers/TwilioProvider'
import { useOpenAITranscription } from '@/hooks/useOpenAITranscription'
import { LeadForm, PricingPanel, TranscriptView } from '@/components/sales-call'
import type { TranscriptItem } from '@/types/sales-call'
import {
  dismissToasts,
  showSuccessToast,
  showErrorToast,
} from '@/lib/error-handling'
import { useFormStore } from '@/stores/formStore'
import { isAutoLogoutDue, useAutoLogout } from '@/hooks/useAutoLogout'

type NutshellFormData = ReturnType<
  ReturnType<typeof useFormStore.getState>['getFormData']
>
type AdditionalContacts = ReturnType<
  typeof useFormStore.getState
>['additionalContacts']

function valueOrEmpty<T>(value: T) {
  return value || ''
}

function buildNutshellPayload(
  formData: NutshellFormData,
  ballpark: string,
  transcript: string,
  additionalContacts: AdditionalContacts,
) {
  return {
    name: valueOrEmpty(formData.name),
    phone: valueOrEmpty(formData.phone),
    email: valueOrEmpty(formData.email),
    position: valueOrEmpty(formData.position),
    website: valueOrEmpty(formData.website),
    decisionMaker: valueOrEmpty(formData.decisionMaker),
    typeName: valueOrEmpty(formData.typeName),
    businessName: valueOrEmpty(formData.businessName),
    entityName: valueOrEmpty(formData.entityName),
    billboardsBeforeYN: valueOrEmpty(formData.billboardsBeforeYN),
    billboardsBeforeDetails: valueOrEmpty(formData.billboardsBeforeDetails),
    billboardPurpose: valueOrEmpty(formData.billboardPurpose),
    accomplishDetails: valueOrEmpty(formData.accomplishDetails),
    targetAudience: valueOrEmpty(formData.targetAudience),
    targetCity: valueOrEmpty(formData.targetCity),
    state: valueOrEmpty(formData.state),
    targetArea: valueOrEmpty(formData.targetArea),
    startMonth: valueOrEmpty(formData.startMonth),
    campaignLength: valueOrEmpty(formData.campaignLength),
    boardType: valueOrEmpty(formData.boardType),
    hasMediaExperience: formData.hasMediaExperience,
    yearsInBusiness: valueOrEmpty(formData.yearsInBusiness),
    leadType: valueOrEmpty(formData.leadType),
    notes: valueOrEmpty(formData.notes),
    sendOver: formData.sendOver || [],
    ballpark: valueOrEmpty(ballpark),
    transcript: valueOrEmpty(transcript),
    additionalContacts: additionalContacts.map((contact) => ({
      name: contact.name,
      position: contact.position,
      phone: contact.phone,
      email: contact.email,
    })),
  }
}

type NutshellResult = {
  error?: string
  missingFields?: unknown
}

type NutshellResponseActions = {
  setStatus: (status: 'success' | 'error') => void
  setMessage: (message: string) => void
  setValidationErrors: (errors: string[]) => void
  clearAll: () => void
}

function handleNutshellResponse(
  response: Response,
  result: NutshellResult,
  actions: NutshellResponseActions,
) {
  if (response.ok) {
    actions.setStatus('success')
    actions.setMessage('Lead created')
    showSuccessToast('Lead sent to Nutshell')
    actions.clearAll()
    return
  }

  actions.setStatus('error')
  actions.setMessage(result.error || 'Failed')
  if (result.missingFields && Array.isArray(result.missingFields)) {
    actions.setValidationErrors(result.missingFields)
  }
  showErrorToast(result.error || 'Failed to create lead')
}

type StatusIndicatorsProps = {
  isExtracting: boolean
  isLoadingBillboard: boolean
  billboardContext: string
  extractionError: string | null | undefined
  canRetry: boolean
  overallConfidence: number
  onRetry: () => void
  onClearError: () => void
}

function StatusIndicators({
  isExtracting,
  isLoadingBillboard,
  billboardContext,
  extractionError,
  canRetry,
  overallConfidence,
  onRetry,
  onClearError,
}: StatusIndicatorsProps) {
  return (
    <div className="flex flex-wrap gap-1 sm:gap-1.5">
      {isExtracting && (
        <div className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-blue-500/30 backdrop-blur-sm border border-blue-300/30 rounded text-[10px] sm:text-xs">
          <span className="text-white font-medium">🤖 Extracting...</span>
        </div>
      )}
      {isLoadingBillboard && (
        <div className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-purple-500/30 backdrop-blur-sm border border-purple-300/30 rounded text-[10px] sm:text-xs">
          <span className="text-white font-medium">📊 Loading pricing...</span>
        </div>
      )}
      {billboardContext && !isLoadingBillboard && (
        <div className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-green-500/30 backdrop-blur-sm border border-green-300/30 rounded text-[10px] sm:text-xs">
          <span className="text-white font-medium">✓ Pricing loaded</span>
        </div>
      )}
      {extractionError && (
        <div className="flex-1 min-w-full px-1.5 sm:px-2 py-1 sm:py-1.5 bg-red-500/30 backdrop-blur-sm border border-red-300/30 rounded">
          <div className="flex items-center justify-between gap-1.5 sm:gap-2">
            <p className="text-white text-[10px] sm:text-xs font-medium truncate">
              {extractionError}
            </p>
            <div className="flex gap-1 sm:gap-1.5 flex-shrink-0">
              {canRetry && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onRetry}
                  className="h-5 sm:h-6 text-[10px] sm:text-xs px-1.5 sm:px-2"
                >
                  Retry
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={onClearError}
                className="h-5 sm:h-6 text-[10px] sm:text-xs px-1.5 sm:px-2 text-white hover:bg-white/20"
              >
                ✕
              </Button>
            </div>
          </div>
        </div>
      )}
      {overallConfidence > 0 && !isExtracting && !extractionError && (
        <div className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-green-500/30 backdrop-blur-sm border border-green-300/30 rounded text-[10px] sm:text-xs">
          <span className="text-white font-medium">
            ✓ Confidence: {overallConfidence}%
          </span>
        </div>
      )}
    </div>
  )
}

// Dynamic imports for heavy map components
const GoogleMapPanel = dynamic(
  () =>
    import('@/components/sales-call/GoogleMapPanel').then(
      (mod) => mod.GoogleMapPanel,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center text-gray-500">
        Loading Google Maps...
      </div>
    ),
  },
)

const ArcGISMapPanel = dynamic(
  () =>
    import('@/components/sales-call/ArcGISMapPanel').then(
      (mod) => mod.ArcGISMapPanel,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center text-gray-500">
        Loading ArcGIS Map...
      </div>
    ),
  },
)

type TwilioState = ReturnType<typeof useTwilioContext>
type TranscriptionState = ReturnType<typeof useOpenAITranscription>

type CallHeaderProps = {
  userEmail: TwilioState['userEmail']
  status: TwilioState['status']
  twilioReady: TwilioState['twilioReady']
  incomingCall: TwilioState['incomingCall']
  callActive: TwilioState['callActive']
  callerPhone: string
  isProcessing: boolean
  isUploading: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void
  onUploadClick: () => void
  onClearAll: () => void
  onHangupCall: TwilioState['hangupCall']
  onAcceptCall: TwilioState['acceptCall']
  onRejectCall: TwilioState['rejectCall']
  isExtracting: boolean
  isLoadingBillboard: boolean
  billboardContext: string
  extractionError: string | null | undefined
  canRetry: boolean
  overallConfidence: number
  onRetryExtraction: () => void
  onClearError: () => void
}

function CallHeader(props: CallHeaderProps) {
  const {
    userEmail,
    status,
    twilioReady,
    incomingCall,
    callActive,
    callerPhone,
    isProcessing,
    isUploading,
    fileInputRef,
    onFileSelect,
    onUploadClick,
    onClearAll,
    onHangupCall,
    onAcceptCall,
    onRejectCall,
    isExtracting,
    isLoadingBillboard,
    billboardContext,
    extractionError,
    canRetry,
    overallConfidence,
    onRetryExtraction,
    onClearError,
  } = props

  return (
    <CardHeader className="bg-gradient-to-r from-blue-600 via-indigo-600 to-primary text-white py-2 sm:py-3 px-3 sm:px-4 flex-shrink-0">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-lg sm:text-xl font-bold tracking-tight truncate">
              Billboard Lead Form
              {userEmail && (
                <span className="text-[10px] sm:text-xs font-normal ml-2 opacity-75 hidden sm:inline">
                  ({userEmail})
                </span>
              )}
            </CardTitle>
            <p className="text-blue-100 text-[10px] sm:text-xs mt-0.5 hidden sm:block">
              Real-time transcription & AI-powered data extraction
            </p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <div
              className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs ${isProcessing ? 'animate-pulse' : ''}`}
            >
              {twilioReady && !callActive && (
                <span
                  className={`inline-block w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full flex-shrink-0 ${status === 'Ready to receive calls' ? 'bg-green-600 animate-pulse' : 'bg-red-600'}`}
                ></span>
              )}
              {callActive && (
                <span className="inline-block w-1.5 h-1.5 sm:w-2 sm:h-2 bg-red-400 rounded-full animate-pulse flex-shrink-0"></span>
              )}
              <span className="font-medium truncate max-w-[100px] sm:max-w-none">
                {status}
              </span>
            </div>
            <div className="flex flex-1 sm:flex-initial gap-1 sm:gap-2">
              {callActive && (
                <Button
                  onClick={onHangupCall}
                  size="sm"
                  className="flex-1 sm:flex-initial bg-red-500 hover:bg-red-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 h-7 sm:h-8 text-[10px] sm:text-xs px-2 sm:px-3"
                >
                  Hang Up
                </Button>
              )}
              <Button
                onClick={onClearAll}
                size="sm"
                variant="secondary"
                className="flex-1 sm:flex-initial bg-white/20 hover:bg-white/30 text-white border border-white/30 font-semibold backdrop-blur-sm h-7 sm:h-8 text-[10px] sm:text-xs px-2 sm:px-3"
                disabled={callActive}
              >
                Clear
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.ogg"
                onChange={onFileSelect}
                disabled={isUploading || callActive}
                className="hidden"
              />
              <Button
                onClick={onUploadClick}
                disabled={isUploading || callActive}
                size="sm"
                className="flex-1 sm:flex-initial bg-white/20 hover:bg-white/30 text-white border border-white/30 font-semibold backdrop-blur-sm h-7 sm:h-8 text-[10px] sm:text-xs px-2 sm:px-3"
              >
                <span className="mr-1 sm:mr-1.5">📁</span>
                <span className="hidden sm:inline">
                  {isUploading ? 'Uploading...' : 'Upload'}
                </span>
                <span className="sm:hidden">
                  {isUploading ? '...' : 'File'}
                </span>
              </Button>
            </div>
          </div>
        </div>
        {incomingCall && (
          <div className="bg-green-500/30 border border-white/30 rounded px-2 sm:px-3 py-1.5 sm:py-2 animate-pulse">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-1.5 sm:gap-2">
              <p className="text-white text-xs sm:text-sm font-semibold">
                📞 Incoming:{' '}
                {incomingCall.customParameters?.get('callerFrom') ||
                  incomingCall.parameters.From}
              </p>
              <div className="flex gap-1.5 sm:gap-2">
                <Button
                  onClick={onAcceptCall}
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 h-6 sm:h-7 text-xs px-2 sm:px-3"
                >
                  Accept
                </Button>
                <Button
                  onClick={onRejectCall}
                  size="sm"
                  variant="destructive"
                  className="h-6 sm:h-7 text-xs px-2 sm:px-3"
                >
                  Reject
                </Button>
              </div>
            </div>
          </div>
        )}
        {callerPhone && !incomingCall && (
          <div className="px-2 py-1 bg-blue-500/30 backdrop-blur-sm border border-blue-300/30 rounded text-[10px] sm:text-xs w-fit">
            <span className="text-white font-medium">
              📱 Caller: {callerPhone}
            </span>
          </div>
        )}
        <StatusIndicators
          isExtracting={isExtracting}
          isLoadingBillboard={isLoadingBillboard}
          billboardContext={billboardContext}
          extractionError={extractionError}
          canRetry={canRetry}
          overallConfidence={overallConfidence}
          onRetry={onRetryExtraction}
          onClearError={onClearError}
        />
      </div>
    </CardHeader>
  )
}

type TabbedBodyProps = {
  resetTrigger: number
  callerPhone: string
  validationErrors: string[]
  billboardContext: string
  transcripts: TranscriptionState['transcripts']
  onNutshellSubmit: () => Promise<void>
  isSubmittingNutshell: boolean
  nutshellStatus: 'idle' | 'success' | 'error'
  nutshellMessage: string
  setIsLoadingBillboard: React.Dispatch<React.SetStateAction<boolean>>
  setBillboardContext: React.Dispatch<React.SetStateAction<string>>
  onClearAll: () => void
  currentMarketLocation: string
  scrollRef: React.RefObject<HTMLDivElement | null>
  interimTranscript: TranscriptionState['interimTranscript']
  interimSpeaker: TranscriptionState['interimSpeaker']
  twilioReady: boolean
}

type LeadActionsProps = {
  onNutshellSubmit: () => Promise<void>
  isSubmittingNutshell: boolean
  nutshellStatus: 'idle' | 'success' | 'error'
  nutshellMessage: string
  onClearAll: () => void
}

function LeadActions({
  onNutshellSubmit,
  isSubmittingNutshell,
  nutshellStatus,
  nutshellMessage,
  onClearAll,
}: LeadActionsProps) {
  const [unqualifiedDialogOpen, setUnqualifiedDialogOpen] = useState(false)

  const handleUnqualifiedDelete = () => {
    onClearAll()
    setUnqualifiedDialogOpen(false)
  }

  return (
    <div className="mt-auto flex flex-shrink-0 flex-col items-center gap-1 border-t border-slate-200 bg-white pt-2 sm:gap-2">
      {nutshellStatus !== 'idle' && (
        <span
          className={`text-[10px] font-medium sm:text-xs ${
            nutshellStatus === 'success' ? 'text-green-600' : 'text-red-600'
          }`}
        >
          {nutshellMessage}
        </span>
      )}
      <div className="flex gap-2">
        <Button
          onClick={onNutshellSubmit}
          disabled={isSubmittingNutshell}
          className="h-7 bg-orange-500 px-3 text-xs font-semibold text-white shadow-lg transition-all duration-200 hover:bg-orange-600 hover:shadow-xl sm:h-9 sm:px-6 sm:text-sm"
        >
          {isSubmittingNutshell ? 'Submitting...' : 'Nutshell'}
        </Button>

        <Dialog
          open={unqualifiedDialogOpen}
          onOpenChange={setUnqualifiedDialogOpen}
        >
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="h-7 border-slate-300 px-3 text-xs font-semibold text-slate-700 shadow-sm transition-all duration-200 hover:bg-slate-100 hover:shadow-md sm:h-9 sm:px-6 sm:text-sm"
            >
              Unqualified
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-800">
                Unqualified Lead
              </DialogTitle>
              <DialogDescription asChild>
                <div className="pt-4">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-slate-700">
                    &quot;I&apos;m with our national office in Dallas. To reach
                    the local office, just search &quot;Lamar Advertising&quot;
                    on your phone&apos;s MAP app, and it&apos;ll give you the
                    actual local number.&quot;
                  </div>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4 sm:justify-center">
              <Button
                variant="destructive"
                onClick={handleUnqualifiedDelete}
                className="bg-red-500 px-8 font-semibold text-white hover:bg-red-600"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

function TabbedBody(props: TabbedBodyProps) {
  const [sidePanel, setSidePanel] = useState<
    'pricing' | 'google-map' | 'bsi-map'
  >('pricing')
  const {
    resetTrigger,
    callerPhone,
    validationErrors,
    billboardContext,
    transcripts,
    onNutshellSubmit,
    isSubmittingNutshell,
    nutshellStatus,
    nutshellMessage,
    setIsLoadingBillboard,
    setBillboardContext,
    onClearAll,
    currentMarketLocation,
    scrollRef,
    interimTranscript,
    interimSpeaker,
    twilioReady,
  } = props
  return (
    <CardContent className="px-1.5 pb-1.5 pt-2 sm:px-2 sm:pb-2 flex flex-col flex-1 min-h-0 overflow-hidden">
      <Tabs
        defaultValue="form"
        onValueChange={() => setSidePanel('pricing')}
        className="w-full flex-1 flex flex-col gap-0 min-h-0 overflow-hidden"
      >
        <TabsList className="grid w-full grid-cols-4 mb-2 bg-slate-100 p-0.5 sm:p-1 rounded-lg h-8 sm:h-9 flex-shrink-0">
          <TabsTrigger
            value="form"
            className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-[10px] sm:text-xs"
          >
            <span className="hidden sm:inline">Lead Form & Pricing</span>
            <span className="sm:hidden">Form</span>
          </TabsTrigger>
          <TabsTrigger
            value="map"
            className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-[10px] sm:text-xs"
          >
            <span className="hidden sm:inline">Google Map</span>
            <span className="sm:hidden">Map</span>
          </TabsTrigger>
          <TabsTrigger
            value="arcgis"
            className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-[10px] sm:text-xs"
          >
            <span className="hidden sm:inline">BSI Map</span>
            <span className="sm:hidden">BSI</span>
          </TabsTrigger>
          <TabsTrigger
            value="transcript"
            className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-[10px] sm:text-xs"
          >
            <span className="hidden sm:inline">Transcript</span>
            <span className="sm:hidden">Trans</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="form"
          forceMount
          className="mt-0 flex-1 min-h-0 overflow-hidden data-[state=inactive]:hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <div
            className={`h-full min-h-0 gap-2 overflow-hidden sm:gap-1 ${
              sidePanel === 'pricing'
                ? 'flex flex-col xl:flex-row'
                : 'grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]'
            }`}
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <LeadForm
                key={resetTrigger}
                inboundPhone={callerPhone}
                validationErrors={validationErrors}
              />
            </div>

            <Tabs
              value={sidePanel}
              onValueChange={(value) => setSidePanel(value as typeof sidePanel)}
              className={`min-h-0 overflow-hidden ${
                sidePanel === 'pricing'
                  ? 'w-full xl:w-[400px] xl:flex-shrink-0'
                  : ''
              }`}
            >
              <TabsList className="mx-auto mb-1 grid h-9 w-full max-w-sm grid-cols-3 rounded-none border-b border-slate-200 bg-transparent p-0">
                <TabsTrigger
                  value="pricing"
                  className="h-9 rounded-none border-x-0 border-t-0 border-b-2 border-transparent bg-transparent text-[10px] font-semibold tracking-wide text-slate-500 shadow-none transition-colors hover:text-slate-900 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent sm:text-xs"
                >
                  Pricing
                </TabsTrigger>
                <TabsTrigger
                  value="google-map"
                  className="h-9 rounded-none border-x-0 border-t-0 border-b-2 border-transparent bg-transparent text-[10px] font-semibold tracking-wide text-slate-500 shadow-none transition-colors hover:text-slate-900 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent sm:text-xs"
                >
                  Google Map
                </TabsTrigger>
                <TabsTrigger
                  value="bsi-map"
                  className="h-9 rounded-none border-x-0 border-t-0 border-b-2 border-transparent bg-transparent text-[10px] font-semibold tracking-wide text-slate-500 shadow-none transition-colors hover:text-slate-900 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent sm:text-xs"
                >
                  BSI Map
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="pricing"
                forceMount
                className="mt-0 min-h-0 overflow-hidden data-[state=inactive]:hidden data-[state=active]:flex data-[state=active]:flex-col"
              >
                <PricingPanel
                  key={`pricing-${resetTrigger}`}
                  billboardContext={billboardContext}
                  setIsLoadingBillboard={setIsLoadingBillboard}
                  setBillboardContext={setBillboardContext}
                />
              </TabsContent>
              <TabsContent
                value="google-map"
                className="mt-0 min-h-0 overflow-hidden data-[state=active]:block"
              >
                <GoogleMapPanel
                  key={`google-map-${resetTrigger}`}
                  initialLocation={currentMarketLocation}
                  exclusiveView
                />
              </TabsContent>
              <TabsContent
                value="bsi-map"
                className="mt-0 min-h-0 overflow-hidden data-[state=active]:block"
              >
                <ArcGISMapPanel
                  key={`arcgis-map-${resetTrigger}`}
                  initialLocation={currentMarketLocation}
                />
              </TabsContent>

              <LeadActions
                onNutshellSubmit={onNutshellSubmit}
                isSubmittingNutshell={isSubmittingNutshell}
                nutshellStatus={nutshellStatus}
                nutshellMessage={nutshellMessage}
                onClearAll={onClearAll}
              />
            </Tabs>
          </div>
        </TabsContent>
        <TabsContent
          value="map"
          className="mt-0 flex-1 min-h-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <div className="h-full overflow-hidden">
            <GoogleMapPanel
              key={`google-map-${resetTrigger}`}
              initialLocation={currentMarketLocation}
            />
          </div>
        </TabsContent>
        <TabsContent
          value="arcgis"
          className="mt-0 flex-1 min-h-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <div className="h-full overflow-hidden">
            <ArcGISMapPanel
              key={`arcgis-map-${resetTrigger}`}
              initialLocation={currentMarketLocation}
            />
          </div>
        </TabsContent>
        <TabsContent
          value="transcript"
          className="mt-0 flex-1 min-h-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <div className="h-full overflow-hidden">
            <TranscriptView
              key={`transcript-${resetTrigger}`}
              ref={scrollRef}
              transcripts={transcripts}
              interimTranscript={interimTranscript}
              interimSpeaker={interimSpeaker}
              twilioReady={twilioReady}
            />
          </div>
        </TabsContent>
      </Tabs>
    </CardContent>
  )
}

function useCallerPhone(incomingCall: TwilioState['incomingCall']) {
  const [callerPhone, setCallerPhone] = useState<string>('')

  useEffect(() => {
    if (!incomingCall) return
    const customFrom = incomingCall.customParameters?.get('callerFrom')
    const from = customFrom || incomingCall.parameters?.From || ''
    if (!from) return
    console.log(
      '📞 Captured caller phone:',
      from,
      customFrom ? '(custom param)' : '(parameters.From)',
    )
    // The Twilio call object is external state; preserve the last captured number.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCallerPhone(from)
  }, [incomingCall])

  return { callerPhone, setCallerPhone }
}

function useCallLifecycle(
  twilio: TwilioState,
  transcription: Pick<
    TranscriptionState,
    'startTranscription' | 'stopTranscription'
  >,
  sessionIssuedAt: number,
  handleCallAccepted: (
    call: Parameters<TranscriptionState['startTranscription']>[0],
  ) => void,
) {
  const {
    onCallAccepted: registerCallAccepted,
    onCallDisconnected: registerCallDisconnected,
    resetStatus,
  } = twilio
  const { startTranscription, stopTranscription } = transcription

  useEffect(() => {
    registerCallAccepted((call) => {
      handleCallAccepted(call)
      startTranscription(call)
    })
    registerCallDisconnected(() => {
      stopTranscription()
      resetStatus()

      // A deferred session logout owns the final offline status update.
      if (isAutoLogoutDue(sessionIssuedAt)) return

      fetch('/api/taskrouter/worker-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'available' }),
      })
        .then((res) =>
          res.ok
            ? console.log('✅ Worker status reset to Available')
            : console.warn('⚠️ Failed to reset worker status'),
        )
        .catch((err) => console.error('❌ Error resetting worker status:', err))
    })
  }, [
    registerCallAccepted,
    registerCallDisconnected,
    startTranscription,
    stopTranscription,
    resetStatus,
    sessionIssuedAt,
    handleCallAccepted,
  ])
}

function useCallSessionProtection(
  sessionIssuedAt: number,
  twilio: TwilioState,
  transcription: Pick<
    TranscriptionState,
    'startTranscription' | 'stopTranscription'
  >,
) {
  const [hasPendingSubmission, setHasPendingSubmission] = useState(false)
  const handleCallAccepted = useCallback(
    (call: { parameters: { CallSid?: string } }) => {
      setHasPendingSubmission(true)
      void fetch('/api/auth/extend-for-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callSid: call.parameters.CallSid }),
      }).then(
        (response) => {
          if (!response.ok) console.error('Failed to extend session for call')
        },
        (error) => console.error('Failed to extend session for call:', error),
      )
    },
    [],
  )
  useCallLifecycle(twilio, transcription, sessionIssuedAt, handleCallAccepted)
  const markSubmitted = useCallback(() => setHasPendingSubmission(false), [])
  return { hasPendingSubmission, markSubmitted }
}

function formatTranscript(transcripts: TranscriptionState['transcripts']) {
  return transcripts
    .map((item) => {
      const speaker = item.speaker === 'agent' ? 'Sales Rep' : 'Caller'
      return `${speaker}: ${item.text}`
    })
    .join('\n')
}

function useTranscriptExtraction(
  transcripts: TranscriptionState['transcripts'],
  interimTranscript: TranscriptionState['interimTranscript'],
  callActive: boolean,
  scrollRef: React.RefObject<HTMLDivElement | null>,
) {
  const updateFromAI = useFormStore((s) => s.updateFromAI)
  const extraction = useBillboardFormExtraction()
  const {
    cleanup,
    clearError,
    extractFields,
    extractionCount,
    formData,
    isExtracting,
  } = extraction
  const hasDoneFinalExtractionRef = useRef<boolean>(false)
  const fullTranscriptRef = useRef<string>('')
  const fullTranscript = useMemo(
    () => formatTranscript(transcripts),
    [transcripts],
  )

  useEffect(() => {
    if (!formData) return
    console.log('🎯 Applying extracted data to form:', formData)
    updateFromAI(formData)
  }, [formData, extractionCount, updateFromAI])
  useEffect(() => {
    fullTranscriptRef.current = fullTranscript
  }, [fullTranscript])
  useEffect(() => {
    if (callActive) hasDoneFinalExtractionRef.current = false
  }, [callActive])
  useEffect(() => {
    if (callActive || hasDoneFinalExtractionRef.current) return
    if (fullTranscriptRef.current.length <= 50) return
    hasDoneFinalExtractionRef.current = true
    console.log('📞 Call ended - running final extraction')
    extractFields(fullTranscriptRef.current)
  }, [callActive, extractFields])
  useEffect(() => () => cleanup(), [cleanup])
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [transcripts, interimTranscript, scrollRef])
  useEffect(() => {
    if (fullTranscript.length > 50 && !isExtracting && callActive) {
      extractFields(fullTranscript)
    }
  }, [fullTranscript, extractFields, isExtracting, callActive])

  const retry = useCallback(() => {
    clearError()
    if (fullTranscript.length > 50) extractFields(fullTranscript)
  }, [clearError, extractFields, fullTranscript])
  const resetFinalExtraction = useCallback(() => {
    hasDoneFinalExtractionRef.current = false
  }, [])
  return { ...extraction, fullTranscript, retry, resetFinalExtraction }
}

function useFileUpload(
  addTranscript: TranscriptionState['addTranscript'],
  updateStatus: TwilioState['updateStatus'],
) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) return
      setIsUploading(true)
      updateStatus('Uploading and transcribing...')
      const formDataUpload = new FormData()
      formDataUpload.append('file', files[0])
      try {
        const res = await fetch('/api/transcribe-file', {
          method: 'POST',
          body: formDataUpload,
        })
        const result = await res.json()
        if (result.text) {
          const newTranscript: TranscriptItem = {
            id: `file-${Date.now()}`,
            text: result.text,
            isFinal: true,
            timestamp: Date.now(),
          }
          addTranscript(newTranscript)
          updateStatus('File transcribed successfully')
        } else updateStatus('Transcription failed')
      } catch (error) {
        console.error('File transcription error:', error)
        updateStatus('Error transcribing file')
      } finally {
        setIsUploading(false)
        if (event.target) event.target.value = ''
      }
    },
    [addTranscript, updateStatus],
  )
  const handleUploadClick = useCallback(() => fileInputRef.current?.click(), [])
  return { fileInputRef, isUploading, handleFileSelect, handleUploadClick }
}

function useNutshellSubmission(
  fullTranscript: string,
  clearAll: () => void,
  onSuccess: () => void,
) {
  const getFormData = useFormStore((s) => s.getFormData)
  const ballpark = useFormStore((s) => s.ballpark)
  const additionalContacts = useFormStore((s) => s.additionalContacts)
  const [isSubmittingNutshell, setIsSubmittingNutshell] = useState(false)
  const [nutshellStatus, setNutshellStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle')
  const [nutshellMessage, setNutshellMessage] = useState('')
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const resetValidation = useCallback(() => {
    dismissToasts()
    setNutshellStatus('idle')
    setNutshellMessage('')
    setValidationErrors([])
  }, [])
  const clearAllWithValidation = useCallback(() => {
    resetValidation()
    clearAll()
  }, [resetValidation, clearAll])
  useEffect(() => {
    if (nutshellStatus !== 'success') return
    const timer = setTimeout(() => {
      setNutshellStatus('idle')
      setNutshellMessage('')
    }, 10000)
    return () => clearTimeout(timer)
  }, [nutshellStatus])
  const submit = useCallback(async () => {
    dismissToasts()
    setIsSubmittingNutshell(true)
    setNutshellStatus('idle')
    setNutshellMessage('')
    setValidationErrors([])
    const formData = getFormData()
    try {
      const response = await fetch('/api/nutshell/create-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildNutshellPayload(
            formData,
            ballpark,
            fullTranscript,
            additionalContacts,
          ),
        ),
      })
      const result: NutshellResult = await response.json()
      handleNutshellResponse(response, result, {
        setStatus: setNutshellStatus,
        setMessage: setNutshellMessage,
        setValidationErrors,
        clearAll,
      })
      if (response.ok) onSuccess()
    } catch (error) {
      console.error('Error submitting to Nutshell:', error)
      setNutshellStatus('error')
      setNutshellMessage('Connection failed')
      showErrorToast('Connection to Nutshell failed')
    } finally {
      setIsSubmittingNutshell(false)
    }
  }, [
    getFormData,
    ballpark,
    fullTranscript,
    additionalContacts,
    clearAll,
    onSuccess,
  ])
  return {
    isSubmittingNutshell,
    nutshellStatus,
    nutshellMessage,
    validationErrors,
    submit,
    clearAllWithValidation,
  }
}

function useClearTranscriber(
  clearTranscripts: TranscriptionState['clearTranscripts'],
  resetExtraction: () => void,
  resetFinalExtraction: () => void,
  setCallerPhone: React.Dispatch<React.SetStateAction<string>>,
  setBillboardContext: React.Dispatch<React.SetStateAction<string>>,
  setResetTrigger: React.Dispatch<React.SetStateAction<number>>,
) {
  const resetForm = useFormStore((store) => store.reset)
  return useCallback(() => {
    clearTranscripts()
    setBillboardContext('')
    resetExtraction()
    resetForm()
    setCallerPhone('')
    setResetTrigger((previous) => previous + 1)
    resetFinalExtraction()
  }, [
    clearTranscripts,
    resetExtraction,
    resetForm,
    setCallerPhone,
    setBillboardContext,
    setResetTrigger,
    resetFinalExtraction,
  ])
}

type Market = {
  targetCity?: string | null
  state?: string | null
  targetArea?: string | null
}
function getMarketLocation(
  activeMarketIndex: number,
  primary: Market,
  additionalMarkets: Market[],
) {
  const market =
    activeMarketIndex === 0 ? primary : additionalMarkets[activeMarketIndex - 1]
  if (!market) return ''

  const city = market.targetCity?.trim()
  const state = market.state?.trim()
  const area = market.targetArea?.trim()

  if (city && state) {
    return area ? `${area}, ${city}, ${state}` : `${city}, ${state}`
  }

  return area || ''
}

function useMarketLocation() {
  const activeMarketIndex = useFormStore((store) => store.activeMarketIndex)
  const additionalMarkets = useFormStore((store) => store.additionalMarkets)
  const targetCity = useFormStore((store) => store.fields.targetCity)
  const state = useFormStore((store) => store.fields.state)
  const targetArea = useFormStore((store) => store.fields.targetArea)
  return useMemo(
    () =>
      getMarketLocation(
        activeMarketIndex,
        { targetCity, state, targetArea },
        additionalMarkets,
      ),
    [activeMarketIndex, targetCity, state, targetArea, additionalMarkets],
  )
}

function isTranscriberProcessing(
  isUploading: boolean,
  isExtracting: boolean,
  status: string,
) {
  if (isUploading || isExtracting) return true
  return [
    'Fetching',
    'Connecting',
    'Starting',
    'Uploading',
    'Initializing',
  ].some((text) => status.includes(text))
}

type TranscriberContentProps = {
  twilio: ReturnType<typeof useTwilioContext>
  transcription: ReturnType<typeof useOpenAITranscription>
  extraction: ReturnType<typeof useTranscriptExtraction>
  upload: ReturnType<typeof useFileUpload>
  nutshell: ReturnType<typeof useNutshellSubmission>
  callerPhone: string
  isProcessing: boolean
  isLoadingBillboard: boolean
  billboardContext: string
  resetTrigger: number
  setIsLoadingBillboard: React.Dispatch<React.SetStateAction<boolean>>
  setBillboardContext: React.Dispatch<React.SetStateAction<string>>
  currentMarketLocation: ReturnType<typeof useMarketLocation>
  scrollRef: React.RefObject<HTMLDivElement | null>
}

function TranscriberContent({
  twilio,
  transcription,
  extraction,
  upload,
  nutshell,
  callerPhone,
  isProcessing,
  isLoadingBillboard,
  billboardContext,
  resetTrigger,
  setIsLoadingBillboard,
  setBillboardContext,
  currentMarketLocation,
  scrollRef,
}: TranscriberContentProps) {
  return (
    <div className="h-full overflow-hidden flex items-center justify-center m-0 p-0">
      <div className="max-w-[1800px] w-full h-full flex flex-col px-2 sm:px-0">
        <Card className="shadow-lg border-0 flex flex-col gap-0 h-full overflow-hidden">
          <CallHeader
            userEmail={twilio.userEmail}
            status={twilio.status}
            twilioReady={twilio.twilioReady}
            incomingCall={twilio.incomingCall}
            callActive={twilio.callActive}
            callerPhone={callerPhone}
            isProcessing={isProcessing}
            isUploading={upload.isUploading}
            fileInputRef={upload.fileInputRef}
            onFileSelect={upload.handleFileSelect}
            onUploadClick={upload.handleUploadClick}
            onClearAll={nutshell.clearAllWithValidation}
            onHangupCall={twilio.hangupCall}
            onAcceptCall={twilio.acceptCall}
            onRejectCall={twilio.rejectCall}
            isExtracting={extraction.isExtracting}
            isLoadingBillboard={isLoadingBillboard}
            billboardContext={billboardContext}
            extractionError={extraction.error}
            canRetry={extraction.canRetry}
            overallConfidence={extraction.overallConfidence}
            onRetryExtraction={extraction.retry}
            onClearError={extraction.clearError}
          />
          <TabbedBody
            resetTrigger={resetTrigger}
            callerPhone={callerPhone}
            validationErrors={nutshell.validationErrors}
            billboardContext={billboardContext}
            transcripts={transcription.transcripts}
            onNutshellSubmit={nutshell.submit}
            isSubmittingNutshell={nutshell.isSubmittingNutshell}
            nutshellStatus={nutshell.nutshellStatus}
            nutshellMessage={nutshell.nutshellMessage}
            setIsLoadingBillboard={setIsLoadingBillboard}
            setBillboardContext={setBillboardContext}
            onClearAll={nutshell.clearAllWithValidation}
            currentMarketLocation={currentMarketLocation}
            scrollRef={scrollRef}
            interimTranscript={transcription.interimTranscript}
            interimSpeaker={transcription.interimSpeaker}
            twilioReady={twilio.twilioReady}
          />
        </Card>
      </div>
    </div>
  )
}

export default function SalesCallTranscriber({
  sessionIssuedAt,
}: {
  sessionIssuedAt: number
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [billboardContext, setBillboardContext] = useState<string>('')
  const [isLoadingBillboard, setIsLoadingBillboard] = useState(false)
  const [resetTrigger, setResetTrigger] = useState(0)
  const twilio = useTwilioContext()
  const transcription = useOpenAITranscription({
    onStatusChange: twilio.updateStatus,
  })
  const callSession = useCallSessionProtection(
    sessionIssuedAt,
    twilio,
    transcription,
  )
  const { callerPhone, setCallerPhone } = useCallerPhone(twilio.incomingCall)
  const extraction = useTranscriptExtraction(
    transcription.transcripts,
    transcription.interimTranscript,
    twilio.callActive,
    scrollRef,
  )
  const upload = useFileUpload(transcription.addTranscript, twilio.updateStatus)
  const clearAll = useClearTranscriber(
    transcription.clearTranscripts,
    extraction.reset,
    extraction.resetFinalExtraction,
    setCallerPhone,
    setBillboardContext,
    setResetTrigger,
  )
  const nutshell = useNutshellSubmission(
    extraction.fullTranscript,
    clearAll,
    callSession.markSubmitted,
  )
  useAutoLogout(
    sessionIssuedAt,
    twilio.callActive ||
      callSession.hasPendingSubmission ||
      nutshell.isSubmittingNutshell,
  )
  const isProcessing = isTranscriberProcessing(
    upload.isUploading,
    extraction.isExtracting,
    twilio.status,
  )
  const currentMarketLocation = useMarketLocation()

  return (
    <TranscriberContent
      twilio={twilio}
      transcription={transcription}
      extraction={extraction}
      upload={upload}
      nutshell={nutshell}
      callerPhone={callerPhone}
      isProcessing={isProcessing}
      isLoadingBillboard={isLoadingBillboard}
      billboardContext={billboardContext}
      resetTrigger={resetTrigger}
      setIsLoadingBillboard={setIsLoadingBillboard}
      setBillboardContext={setBillboardContext}
      currentMarketLocation={currentMarketLocation}
      scrollRef={scrollRef}
    />
  )
}
