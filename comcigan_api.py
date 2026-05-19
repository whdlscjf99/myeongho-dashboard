"""
컴시간 시간표 API 서버
Electron 대시보드용 백엔드
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
from comcigan_modified import School  # 수정된 라이브러리 사용
import json

app = Flask(__name__)
CORS(app)

# 전역 학교 인스턴스 캐시
school_cache = {}

def get_school_instance(school_name="명호중학교"):
    """학교 인스턴스 캐싱"""
    if school_name not in school_cache:
        try:
            school_cache[school_name] = School(school_name)
        except Exception as e:
            raise Exception(f"학교 로드 실패: {e}")
    return school_cache[school_name]

@app.route('/api/timetable/class', methods=['GET'])
def get_class_timetable():
    """
    반 시간표 조회
    GET /api/timetable/class?grade=1&class=1
    """
    try:
        grade = int(request.args.get('grade', 1))
        class_num = int(request.args.get('class', 1))
        school_name = request.args.get('school', '명호중학교')
        
        school = get_school_instance(school_name)
        
        # 시간표 데이터 추출
        class_schedule = school[grade][class_num]
        
        # 요일별로 정리
        days = ['월', '화', '수', '목', '금']
        timetable = {}
        
        for day_idx, day_name in enumerate(days):
            day_schedule = class_schedule[day_idx]
            timetable[day_name] = []
            
            for period_idx, subject_info in enumerate(day_schedule):
                if subject_info:  # None이 아닌 경우
                    if len(subject_info) == 4:
                        subject_name, subject_full, teacher_name, _ = subject_info
                    else:
                        subject_name, subject_full, teacher_name = subject_info
                    timetable[day_name].append({
                        'period': period_idx + 1,
                        'subject': subject_name,
                        'subject_full': subject_full,
                        'teacher': teacher_name
                    })
                else:
                    timetable[day_name].append({
                        'period': period_idx + 1,
                        'subject': '',
                        'subject_full': '',
                        'teacher': ''
                    })
        
        return jsonify({
            'success': True,
            'data': {
                'school': school.name,
                'grade': grade,
                'class': class_num,
                'timetable': timetable
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@app.route('/api/timetable/teacher', methods=['GET'])
def get_teacher_timetable():
    """
    교사 시간표 조회
    GET /api/timetable/teacher?name=홍길동
    GET /api/timetable/teacher?name=김나&teacher_id=8  (동명이인 선택 후)
    """
    try:
        teacher_name_input = request.args.get('name', '')
        teacher_id_param = request.args.get('teacher_id')  # 동명이인 선택 후
        school_name = request.args.get('school', '명호중학교')
        
        if not teacher_name_input:
            return jsonify({
                'success': False,
                'error': '교사 이름을 입력하세요'
            }), 400
        
        school = get_school_instance(school_name)
        days = ['월', '화', '수', '목', '금']
        
        # ═══ teacher_id 지정 시: 바로 시간표 생성 (동명이인 선택 완료) ═══
        if teacher_id_param:
            selected_teacher_id = int(teacher_id_param)
            
            # 해당 teacher_id의 이름 찾기
            selected_name = None
            for grade in range(1, 4):
                if selected_name:
                    break
                try:
                    grade_data = school[grade]
                    for class_num in range(1, len(grade_data)):
                        try:
                            class_data = grade_data[class_num]
                            for day_idx in range(len(days)):
                                try:
                                    day_data = class_data[day_idx]
                                    for subject_info in day_data:
                                        if subject_info and len(subject_info) == 4:
                                            _, _, teacher_original, teacher_id = subject_info
                                            if teacher_id == selected_teacher_id:
                                                selected_name = teacher_original
                                                break
                                    if selected_name:
                                        break
                                except:
                                    continue
                        except:
                            continue
                except:
                    continue
            
            if not selected_name:
                return jsonify({
                    'success': False,
                    'error': f'teacher_id {selected_teacher_id}를 찾을 수 없습니다'
                }), 404
            
            # 시간표 생성
            teacher_schedule = {day: [] for day in days}
            
            for grade in range(1, 4):
                try:
                    grade_data = school[grade]
                    for class_num in range(1, len(grade_data)):
                        try:
                            class_data = grade_data[class_num]
                            for day_idx, day_name in enumerate(days):
                                try:
                                    day_data = class_data[day_idx]
                                    for period_idx, subject_info in enumerate(day_data):
                                        if subject_info and len(subject_info) == 4:
                                            subject_name, subject_full, teacher, teacher_id = subject_info
                                            
                                            if teacher_id == selected_teacher_id:
                                                teacher_schedule[day_name].append({
                                                    'period': period_idx + 1,
                                                    'subject': subject_name,
                                                    'subject_full': subject_full,
                                                    'grade': grade,
                                                    'class': class_num,
                                                    'location': f"{grade}{class_num:02d}"
                                                })
                                except:
                                    continue
                        except:
                            continue
                except:
                    continue
            
            # 교시별 정렬
            for day in days:
                teacher_schedule[day].sort(key=lambda x: x['period'])
            
            return jsonify({
                'success': True,
                'data': {
                    'school': school.name,
                    'teacher': selected_name,
                    'teacher_id': selected_teacher_id,  # 추가
                    'timetable': teacher_schedule
                }
            })
        
        # ═══ 이름으로 검색: 교사 찾기 ═══
        # 1단계: 일치하는 교사 찾기 + 과목 정보 수집
        found_teachers = {}  # {teacherId: {'name': 원본이름, 'clean': 정제이름, 'subjects': {과목: 횟수}}}
        days = ['월', '화', '수', '목', '금']
        input_clean = teacher_name_input.replace('*', '').strip()
        
        for grade in range(1, 4):
            try:
                grade_data = school[grade]
                for class_num in range(1, len(grade_data)):
                    try:
                        class_data = grade_data[class_num]
                        for day_idx in range(len(days)):
                            try:
                                day_data = class_data[day_idx]
                                for subject_info in day_data:
                                    if subject_info and len(subject_info) == 4:  # teacherId 포함된 4-tuple
                                        subject_name, _, teacher_original, teacher_id = subject_info
                                        if not teacher_original:
                                            continue
                                        
                                        teacher_clean = teacher_original.replace('*', '').strip()
                                        
                                        # 매칭 조건: 컴시간 이름이 입력으로 시작하면 매칭
                                        # "김" 입력 → "김", "김나", "김주", "김형" 모두 매칭
                                        # "김나" 입력 → "김나" 매칭
                                        # "김나영" 입력 → "김나" 매칭 (마지막 글자 무시)
                                        
                                        if teacher_clean.startswith(input_clean):
                                            if teacher_id not in found_teachers:
                                                found_teachers[teacher_id] = {
                                                    'name': teacher_original,
                                                    'clean': teacher_clean,
                                                    'subjects': {}
                                                }
                                            # 과목 카운트
                                            if subject_name:
                                                found_teachers[teacher_id]['subjects'][subject_name] = \
                                                    found_teachers[teacher_id]['subjects'].get(subject_name, 0) + 1
                            except:
                                continue
                    except:
                        continue
            except:
                continue
        
        if not found_teachers:
            return jsonify({
                'success': False,
                'error': f'"{teacher_name_input}"과(와) 일치하는 교사를 찾을 수 없습니다'
            }), 404
        
        # 디버그 로깅
        print(f"\n[DEBUG] 검색어: '{teacher_name_input}' (정제: '{input_clean}')")
        print(f"[DEBUG] 매칭된 교사 수: {len(found_teachers)}")
        for teacher_id, info in found_teachers.items():
            main_subject = max(info['subjects'].items(), key=lambda x: x[1])[0] if info['subjects'] else '과목없음'
            print(f"[DEBUG]   - {teacher_id:02d}. {info['name']} ({main_subject})")
        
        # 동명이인이면 목록 반환 (teacherId + 원본이름 + 대표과목)
        if len(found_teachers) > 1:
            teacher_list = []
            for teacher_id, info in found_teachers.items():
                # 가장 많이 가르치는 과목 찾기
                if info['subjects']:
                    main_subject = max(info['subjects'].items(), key=lambda x: x[1])[0]
                    display_name = f"{teacher_id:02d}. {info['name']} ({main_subject})"
                else:
                    display_name = f"{teacher_id:02d}. {info['name']}"
                
                teacher_list.append({
                    'teacher_id': teacher_id,  # teacherId 추가
                    'name': info['name'],  # 원본 이름
                    'display': display_name  # 화면 표시: "08. 김나* (사회)"
                })
            
            return jsonify({
                'success': True,
                'multiple': True,
                'teachers': teacher_list
            })
        
        # 2단계: 시간표 생성 (teacherId로 검색)
        selected_teacher_id = list(found_teachers.keys())[0]
        selected_name = found_teachers[selected_teacher_id]['name']
        teacher_schedule = {day: [] for day in days}
        
        for grade in range(1, 4):
            try:
                grade_data = school[grade]
                for class_num in range(1, len(grade_data)):
                    try:
                        class_data = grade_data[class_num]
                        for day_idx, day_name in enumerate(days):
                            try:
                                day_data = class_data[day_idx]
                                for period_idx, subject_info in enumerate(day_data):
                                    if subject_info and len(subject_info) == 4:
                                        subject_name, subject_full, teacher, teacher_id = subject_info
                                        
                                        # teacherId로 매칭
                                        if teacher_id == selected_teacher_id:
                                            teacher_schedule[day_name].append({
                                                'period': period_idx + 1,
                                                'subject': subject_name,
                                                'subject_full': subject_full,
                                                'grade': grade,
                                                'class': class_num,
                                                'location': f"{grade}{class_num:02d}"
                                            })
                            except:
                                continue
                    except:
                        continue
            except:
                continue
        
        # 교시별 정렬
        for day in days:
            teacher_schedule[day].sort(key=lambda x: x['period'])
        
        return jsonify({
            'success': True,
            'data': {
                'school': school.name,
                'teacher': selected_name,
                'teacher_id': selected_teacher_id,  # 추가
                'timetable': teacher_schedule
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@app.route('/api/school/info', methods=['GET'])
def get_school_info():
    """
    학교 정보 조회
    GET /api/school/info?name=명호중학교
    """
    try:
        school_name = request.args.get('name', '명호중학교')
        school = get_school_instance(school_name)
        
        return jsonify({
            'success': True,
            'data': {
                'name': school.name
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@app.route('/api/health', methods=['GET'])
def health_check():
    """서버 상태 확인"""
    return jsonify({
        'success': True,
        'status': 'running'
    })

if __name__ == '__main__':
    print("컴시간 시간표 API 서버 시작...")
    print("포트: 5001")
    print("엔드포인트:")
    print("  - GET /api/timetable/class?grade=1&class=1")
    print("  - GET /api/timetable/teacher?name=교사명")
    print("  - GET /api/school/info?name=학교명")
    print("  - GET /api/health")
    
    app.run(host='127.0.0.1', port=5001, debug=False)
