import { Injectable } from '@angular/core';

import { Subject, Observable } from 'rxjs/Rx';
import 'rxjs/Rx';

import { Router } from '@angular/router';
import {
  AngularFire, FirebaseListObservable, FirebaseAuthState
} from 'angularfire2';

import {
  DataService, Id, Exam, ExamResult,
  Question, AnswerType, UserInfo, Lib,
  TFQChoices, ARQChoices,
  EmptyExamImpl, EmptyQuestionImpl, EMPTY_EXAM
} from './data.service'

class ExamImpl extends Exam {
  public questions = []
  constructor(e: any) {
    super()
    this.name = e.name
    this.id = e.$key
    this.questions = e.questions
    this.when = new Date(e.when)
  }
}

class QuestionImpl extends Question {
  constructor(public qid: string) {
    super()
  }
  static setObj(qsrc, qtarget: any) {
    qtarget.html = qsrc.display
    qtarget.type = AnswerType["" + qsrc.type]
    switch (qtarget.type) {
      case AnswerType.TFQ:
        qtarget.choices = TFQChoices.slice(0)
        break;
      case AnswerType.ARQ:
        qtarget.choices = ARQChoices.slice(0)
        break;
      default:
        qtarget.choices = qsrc.choices.slice(0)
        break
    }
    qsrc.solutions.forEach(n => qtarget.solutions[n] = true)
  }
}

let qs = {}
function cacheQuestion(qo) {
  let q = new QuestionImpl(qo.$key)
  QuestionImpl.setObj(qo, q)
  qs[q.qid] = q
}

function fbObjToArr(obj): any[] {
  let arr = []
  Object.keys(obj).forEach(function(key,index) {
    arr[+key] = obj[key]
  })
  return arr
}

class ResultImpl extends ExamResult {
  public answers = []
  constructor(r: any) {
    super(null, new Date(r.when))
    this.id = r.$key
    this.eid = r.exam
    this.name = "Result for " + this.id + ":" + this.eid
    this.answers = fbObjToArr(r.answers)
    this.when = new Date(r.when)
  }
}

const URL_VER = "ver3/"
const EXAMS_URL = URL_VER + "exams"
const RESULTS_URL = URL_VER + "results/"
const QUESTION_URL = URL_VER + "questions"

@Injectable()
export class FirebaseDataService extends DataService {
  af: AngularFire
  router: Router
  cache = {}

  private cacheObj(i: Id): any {
    if (this.cache[i.id] == undefined) this.cache[i.id] = i
    this.cache[i.id].seal += " cache"
    return this.cache[i.id]
  }

  private updateResult(src, target: Exam) {
    target.name = src.name
    target.inAnswerMode = true
    console.log("Questions count: " + src.qs.length);
    src.qs.forEach((q, i) => {
      target.qs[i] = new Question()
      let thisq = target.qs[i]
      thisq.html = q.html
      thisq.type = q.type
      q.choices.forEach((_, j) => {
        thisq.choices[j] = q.choices[j]
        thisq.solutions[j] = q.solutions[j]
        thisq.answers[j] = q.answers[j]
      })
    })
  }

  private resultsUrl(): string {
    return RESULTS_URL + this.userInfo.uid + '/'
  }

  private init(af: AngularFire) {
    let revwhen = { query: { orderByChild: 'revwhen' } }

    console.log(EXAMS_URL)
    this.exams$ = af.database.list(EXAMS_URL, revwhen).map(arr => {
      console.log('exams map *')
      return arr.map((o, i) => this.cacheObj(new ExamImpl(o)))
    })

    console.log(this.resultsUrl())
    this.results$ = af.database.list(this.resultsUrl(), revwhen).map(arr => {
      console.log('results map *')
      return arr.map((o, i) => this.cacheObj(new ResultImpl(o)))
    })

    console.log(QUESTION_URL);
    af.database.list(QUESTION_URL).subscribe(qsos => {
      qsos.forEach(qo => cacheQuestion(qo))
      console.log('global qs: ', Object.keys(qs).length);
      this.exams$.subscribe(es => {
        console.log("computing exams... ", es.length)
        es.forEach(e => e.questions.forEach(qid => e.qs.push(qs[qid])))
        this.results$.subscribe(rs => {
          rs.forEach(r => {
            //console.log("result0:", r.eid, r.name, r);
            let e = this.cache[r.eid]
            this.updateResult(e, r)
            console.log("result1:", r.id, r.name)
            r.answers.forEach((ans, i) => {
              ans.forEach(j => r.qs[i].answers[j] = true)
            })
          })
        })
      })
    })
  }

  private loginSucceeded(af: AngularFire, auth: FirebaseAuthState) {
    console.log(auth.uid)
    console.log(auth.auth.displayName)
    console.log(auth.auth.email)
    this.userInfo.setAll(
      auth.uid, auth.auth.displayName, auth.auth.email
    )
    this.init(af)
  }

  private loginFailed() {
    this.userInfo.clearAll()
  }

  constructor(af: AngularFire, private _router: Router) {
    super()
    this.af = af
    this.router = _router

    console.log("START...!")
    this.af.auth.subscribe(auth => {
      qs = {} //reset: throw out all old data!!
      console.log(auth)
      if (auth) this.loginSucceeded(af, auth)
      else this.loginFailed()
    });

  }

  public getExam(eid: string): Exam {
    let e: Exam = this.cache[eid]
    if (e == null) return EMPTY_EXAM
    else return e
  }

  public getQuestion(eid: string, qid: string): Question {
    let q = this.getExam(eid).qs[qid]
    return q
  }

  private saveResultInFirebase(exam: Exam): ExamResult {
    let examResult = new ExamResult(exam)
    let ro = {}
    ro['exam'] = exam.id
    let anss = []
    exam.qs.forEach(q => {
      let ans = []
      q.answers.forEach((a, i) => {
        if (a) ans.push(i)
      })
      anss.push(ans)
    })
    ro['answers'] = anss
    ro['when'] = Date.now()
    ro['revwhen'] = -Date.now()
    console.log("saveResult", ro)
    console.log(this.resultsUrl())
    this.af.database.list(this.resultsUrl()).push(ro).then((call) => {
      console.log(call)
    })
    return examResult
  }

  public saveExam(exam: Exam) {
    let er = this.saveResultInFirebase(exam)
    exam.reset()
    this.cache[er.id] = er
    return er
  }

  public isLoggedIn(): Promise<boolean> {
    console.log("IS LOGGED IN - called!")
    return Promise.resolve(this.userInfo.uid !== null)
  }

  public login(): Promise<any> {
    return Promise.resolve(this.af.auth.login())
  }

  public logout(): Promise<void> {
    return Promise.resolve(this.af.auth.logout())
  }

  public ensureAuth() {
    this.af.auth.subscribe(auth => {
      console.log('Ensuring Auth!!')
      if (!auth) this.router.navigateByUrl('')
    })
  }
}
