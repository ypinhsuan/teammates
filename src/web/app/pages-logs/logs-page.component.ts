import { Component, OnInit } from '@angular/core';
import moment from 'moment-timezone';
import { forkJoin, Observable } from 'rxjs';
import { concatMap, finalize, map } from 'rxjs/operators';
import { LogService } from '../../services/log.service';
import { StatusMessageService } from '../../services/status-message.service';
import { LOCAL_DATE_TIME_FORMAT, TimeResolvingResult, TimezoneService } from '../../services/timezone.service';
import { ApiConst } from '../../types/api-const';
import { GeneralLogEntry, GeneralLogs, Type } from '../../types/api-output';
import { LogsTableRowModel } from '../components/logs-table/logs-table-model';
import { DateFormat } from '../components/session-edit-form/session-edit-form-model';
import { TimeFormat } from '../components/session-edit-form/time-picker/time-picker.component';
import { ErrorMessageOutput } from '../error-message-output';

/**
 * Model for searching of logs.
 */
interface SearchLogsFormModel {
  logsSeverity: Set<string>;
  logsDateFrom: DateFormat;
  logsDateTo: DateFormat;
  logsTimeFrom: TimeFormat;
  logsTimeTo: TimeFormat;
}

/**
 * Query parameters for HTTP request
 */
interface QueryParams {
  searchFrom: string;
  searchUntil: string;
  severities: string;
  nextPageToken?: string;
}

/**
 * Model for storing logs in pages.
 */
interface LogPages {
  logResult: LogsTableRowModel[];
}

/**
 * Admin and maintainer logs page.
 */
@Component({
  selector: 'tm-logs-page',
  templateUrl: './logs-page.component.html',
  styleUrls: ['./logs-page.component.scss'],
})
export class LogsPageComponent implements OnInit {
  LOGS_RETENTION_PERIOD_IN_DAYS: number = ApiConst.LOGS_RETENTION_PERIOD;
  LOGS_RETENTION_PERIOD_IN_MILLISECONDS: number = this.LOGS_RETENTION_PERIOD_IN_DAYS * 24 * 60 * 60 * 1000;
  SEVERITIES: string[] = ['INFO', 'WARNING', 'ERROR'];

  formModel: SearchLogsFormModel = {
    logsSeverity: new Set(),
    logsDateFrom: { year: 0, month: 0, day: 0 },
    logsTimeFrom: { hour: 0, minute: 0 },
    logsDateTo: { year: 0, month: 0, day: 0 },
    logsTimeTo: { hour: 0, minute: 0 },
  };
  previousQueryParams: QueryParams = { searchFrom: '', searchUntil: '', severities: '' };
  dateToday: DateFormat = { year: 0, month: 0, day: 0 };
  earliestSearchDate: DateFormat = { year: 0, month: 0, day: 0 };
  searchResults: LogsTableRowModel[] = [];
  pageResults: LogPages[] = [];
  currentPageNumber: number = 0;
  isLoading: boolean = false;
  isSearching: boolean = false;
  hasResult: boolean = false;
  nextPageToken: string = '';

  constructor(private logService: LogService,
    private timezoneService: TimezoneService,
    private statusMessageService: StatusMessageService) { }

  ngOnInit(): void {
    const today: Date = new Date();
    this.dateToday.year = today.getFullYear();
    this.dateToday.month = today.getMonth() + 1;
    this.dateToday.day = today.getDate();

    const earliestSearchDate: Date = new Date(Date.now() - this.LOGS_RETENTION_PERIOD_IN_MILLISECONDS);
    this.earliestSearchDate.year = earliestSearchDate.getFullYear();
    this.earliestSearchDate.month = earliestSearchDate.getMonth() + 1;
    this.earliestSearchDate.day = earliestSearchDate.getDate();

    this.formModel.logsDateFrom = { ...this.dateToday, day: today.getDate() - 1 };
    this.formModel.logsDateTo = { ...this.dateToday };
    this.formModel.logsTimeFrom = { hour: 23, minute: 59 };
    this.formModel.logsTimeTo = { hour: 23, minute: 59 };
  }

  toggleSelection(severity: string): void {
    this.formModel.logsSeverity.has(severity)
      ? this.formModel.logsSeverity.delete(severity)
      : this.formModel.logsSeverity.add(severity);
  }

  searchForLogs(): void {
    this.isSearching = true;
    this.searchResults = [];
    this.pageResults = [];
    this.currentPageNumber = 0;
    this.nextPageToken = '';
    const localDateTime: Observable<number>[] = [
      this.resolveLocalDateTime(this.formModel.logsDateFrom, this.formModel.logsTimeFrom, 'Search period from'),
      this.resolveLocalDateTime(this.formModel.logsDateTo, this.formModel.logsTimeTo, 'Search period until'),
    ];

    forkJoin(localDateTime)
        .pipe(
            concatMap(([timestampFrom, timestampUntil]: number[]) => {
              this.previousQueryParams = {
                searchFrom: timestampFrom.toString(),
                searchUntil: timestampUntil.toString(),
                severities: Array.from(this.formModel.logsSeverity).join(','),
              }
              return this.logService.searchLogs(this.previousQueryParams);
            }),
            finalize(() => {
              this.isSearching = false;
              this.hasResult = true;
            }))
            .subscribe((generalLogs: GeneralLogs) => this.processLogs(generalLogs),
              (e: ErrorMessageOutput) => this.statusMessageService.showErrorToast(e.error.message));
  }

  private processLogs(generalLogs: GeneralLogs): void {
    if (generalLogs.nextPageToken) {
      this.nextPageToken = generalLogs.nextPageToken;
    } else {
      this.nextPageToken = '';
    }
    
    generalLogs.logEntries.forEach((log: GeneralLogEntry) => this.searchResults.push(this.toLogModel(log)));
    this.pageResults.push({ logResult: this.searchResults });
  }

  private resolveLocalDateTime(date: DateFormat, time: TimeFormat, fieldName: string): Observable<number> {
    const inst: any = moment();
    inst.set('year', date.year);
    inst.set('month', date.month - 1);
    inst.set('date', date.day);
    inst.set('hour', time.hour);
    inst.set('minute', time.minute);
    const localDateTime: string = inst.format(LOCAL_DATE_TIME_FORMAT);

    return this.timezoneService.getResolvedTimestamp(localDateTime, this.timezoneService.guessTimezone(), fieldName)
        .pipe(map((result: TimeResolvingResult) => result.timestamp));
  }

  toLogModel(log: GeneralLogEntry): LogsTableRowModel {
    let summary: string = '';
    let payload: any = '';
    let responseStatus: number | undefined = undefined;
    let responseTime: number | undefined = undefined;
    if (log.payload.type === Type.STRING) {
      summary = 'Source: ' + log.sourceLocation.file;
      payload = this.formatTextPayloadForDisplay(log.payload.data);
    } else if (log.payload.type === Type.JSON) {
      payload = JSON.parse(JSON.stringify(log.jsonObject)).map;
      if (payload.requestMethod) {
        summary += payload.requestMethod + ' ';
      }
      if (payload.requestUrl) {
        summary += payload.requestUrl + ' ';
      }
      if (payload.responseStatus) {
        responseStatus = payload.responseStatus;
      }
      if (payload.responseTime) {
        responseTime = payload.responseTime;
      }
      if (payload.actionClass) {
        summary += payload.actionClass;
      }
    }
    return {
      timestamp: this.timezoneService.formatToString(log.timestamp, this.timezoneService.guessTimezone(), 'DD MMM, YYYY hh:mm:ss A'),
      severity: log.severity,
      summary: summary,
      httpStatus: responseStatus,
      responseTime: responseTime,
      details: JSON.parse(JSON.stringify({
        sourceLocation: log.sourceLocation,
        trace: log.trace,
        payload: payload })),
      isDetailsExpanded: false,
    };
  }

  private formatTextPayloadForDisplay(textPayload: String): String {
    return textPayload
      .replace(/\n/g, '<br/>')
      .replace(/\t/g, '&#9;');
  }

  getPreviousPageLogs(): void {
    if (this.currentPageNumber > 0) {
      this.currentPageNumber = this.currentPageNumber - 1;
      this.searchResults = this.pageResults[this.currentPageNumber].logResult;
    }
  }

  getNextPageLogs(): void {
    this.currentPageNumber = this.currentPageNumber + 1;
    if (this.pageResults.length > this.currentPageNumber) {
      this.searchResults = this.pageResults[this.currentPageNumber].logResult;
      return;
    }
    this.isSearching = true;
    this.searchResults = [];
    this.previousQueryParams.nextPageToken = this.nextPageToken;
    this.logService.searchLogs(this.previousQueryParams)
      .pipe(finalize(() => this.isSearching = false))
      .subscribe((generalLogs: GeneralLogs) => this.processLogs(generalLogs),
      (e: ErrorMessageOutput) => this.statusMessageService.showErrorToast(e.error.message));
  }
}