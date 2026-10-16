export type Question = {
  id: string;
  section: string;
  topic: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  passage?: string;
  audio?: string;
};
export type Lesson = {
  id: string;
  order: number;
  pattern: string;
  title: string;
  explanation: string;
  example: string;
  translation: string;
  questionId: string;
};
export const lessons: Lesson[];
export const questions: Question[];
export const examSections: {
  id: string;
  title: string;
  minutes: number;
  ids: string[];
}[];
