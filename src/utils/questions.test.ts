import { describe, expect, it } from 'vitest'
import {
  FIXED_TURNING_POINT_QUESTION_ID,
  getQuestionnaireQuestionsFromProfile,
} from './questions'

describe('getQuestionnaireQuestionsFromProfile', () => {
  it('reuses saved question ids and text instead of new random draw', () => {
    const saved = [
      { id: 3, category: '金錢觀', text: '題 A', answer: '我的回答 A 超過十字' },
      { id: 12, category: '工作與生活平衡', text: '題 B', answer: '回答 B 內容' },
      { id: 25, category: '未來規劃與自尊', text: '題 C', answer: '回答 C' },
      { id: 7, category: '金錢觀', text: '題 D', answer: '回答 D' },
      { id: 19, category: '工作與生活平衡', text: '題 E', answer: '回答 E' },
      {
        id: FIXED_TURNING_POINT_QUESTION_ID,
        category: '未來規劃與自尊',
        text: '轉折題',
        answer: '轉折回答',
      },
    ]
    const qs = getQuestionnaireQuestionsFromProfile('male', saved)
    expect(qs.map((q) => q.id)).toEqual([3, 12, 25, 7, 19, FIXED_TURNING_POINT_QUESTION_ID])
    expect(qs[0].text).toBe('題 A')
  })

  it('falls back to random when profile has no questionnaire', () => {
    const qs = getQuestionnaireQuestionsFromProfile('male', null)
    expect(qs).toHaveLength(6)
    expect(qs[5]?.id).toBe(FIXED_TURNING_POINT_QUESTION_ID)
  })
})
