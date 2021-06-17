import { Component, Input, OnInit } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { StatusMessageService } from '../../../services/status-message.service';
import { TimezoneService } from '../../../services/timezone.service';
import { Course, FeedbackSession } from '../../../types/api-output';
import { COURSE_ID_MAX_LENGTH } from '../../../types/field-validator';

interface Timezone {
  id: string;
  offset: string;
}

/**
 * Copy course modal.
 */
@Component({
  selector: 'tm-copy-course-modal',
  templateUrl: './copy-course-modal.component.html',
  styleUrls: ['./copy-course-modal.component.scss'],
})
export class CopyCourseModalComponent implements OnInit {

  // const
  COURSE_ID_MAX_LENGTH: number = COURSE_ID_MAX_LENGTH;

  @Input()
  courseToFeedbackSession: Record<string, FeedbackSession[]> = {};

  @Input()
  activeCourses: Course[] = [];

  @Input()
  allCourses: Course[] = [];

  isCopyFromOtherSession: boolean = false;
  hasCourseId: boolean = false;
  timezones: Timezone[] = [];
  newTimezone: string = '';
  newCourseId: string = '';
  newCourseName: string = '';
  oldCourseId: string = '';
  oldCourseName: string = '';

  selectedFeedbackSessions: Set<FeedbackSession> = new Set<FeedbackSession>();

  constructor(public activeModal: NgbActiveModal,
              private statusMessageService: StatusMessageService,
              private timezoneService: TimezoneService) {}

  ngOnInit(): void {
    Object.entries(this.timezoneService.getTzOffsets())
      .map(([id, offset]: [string, number]) => {
        const hourOffset: number = Math.floor(Math.abs(offset) / 60);
        const minOffset: number = Math.abs(offset) % 60;
        const sign: string = offset < 0 ? '-' : '+';
        this.timezones.push({
          id,
          offset: offset === 0 ? 'UTC' : `UTC ${sign}${zeroPad(hourOffset)}:${zeroPad(minOffset)}`,
        });
      });
    this.newTimezone = this.timezoneService.guessTimezone();
  }

  /**
   * Fires the copy event.
   */
  copy(): void {
    if (!this.newCourseId || !this.newCourseName) {
      this.statusMessageService.showErrorToast(
          'Please make sure you have filled in both Course ID and Name before adding the course!');
      return;
    }

    this.hasCourseId = this.allCourses.filter((course: Course) => course.courseId === this.newCourseId).length > 0;
    if (this.hasCourseId) {
      this.statusMessageService.showErrorToast(
        `The course ID ${this.newCourseId} has been used by another course, possibly by some other user.`);
      return;
    }

    this.activeModal.close({
      newCourseId: this.newCourseId,
      newCourseName: this.newCourseName,
      newTimeZone: this.newTimezone,
      selectedFeedbackSessionList: Array.from(this.selectedFeedbackSessions),
      totalNumberOfSessions: this.selectedFeedbackSessions.size,
    });
  }

  /**
   * Toggles selection of a feedback session.
   */
  toggleSelection(session: FeedbackSession): void {
    this.selectedFeedbackSessions.has(session)
      ? this.selectedFeedbackSessions.delete(session)
      : this.selectedFeedbackSessions.add(session);
  }

  /**
   * Select all sessions or clear all sessions
   */
  toggleSelectionForAll(): void {
    this.selectedFeedbackSessions.size === this.courseToFeedbackSession[this.oldCourseId].length
      ? this.clearSelectedFeedbackSession()
      : this.selectedFeedbackSessions = new Set(this.courseToFeedbackSession[this.oldCourseId]);
  }

  /**
   * Auto-detects timezone for instructor.
   */
  onAutoDetectTimezone(): void {
    this.newTimezone = this.timezoneService.guessTimezone();
  }

  /**
   * Clears all selected feedback sessions.
   */
  clearSelectedFeedbackSession(): void {
    this.selectedFeedbackSessions.clear();
  }

}

const zeroPad: (num: number) => any = (num: number) => String(num).padStart(2, '0');
