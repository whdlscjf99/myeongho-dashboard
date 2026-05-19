# test_comcigan.py - API 엔드포인트 탐색
from requests import get
import json

URL = "http://222.106.100.23:4082"

# 1. 학교 검색 API 테스트
print("=== 학교 검색 API 테스트 ===")
search_encoded = "%EB%AA%85%ED%98%B8%EC%A4%91%ED%95%99%EA%B5%90"  # "명호중학교" URL 인코딩
try:
    resp = get(f"{URL}/73141?{search_encoded}", timeout=10)
    resp.encoding = "UTF-8"
    print(f"Status: {resp.status_code}")
    print(f"Response: {resp.text[:500]}")
    
    # JSON 파싱 시도
    try:
        data = json.loads(resp.text.replace('\0', ''))
        print(f"\nParsed JSON keys: {data.keys()}")
        if '학교검색' in data:
            print(f"학교검색 결과: {data['학교검색']}")
    except:
        pass
except Exception as e:
    print(f"Error: {e}")

# 2. 다른 엔드포인트 시도
print("\n=== 다른 가능한 엔드포인트 ===")
for endpoint in ['/36179', '/36180', '/st?', '/data']:
    try:
        resp = get(f"{URL}{endpoint}", timeout=5)
        print(f"{endpoint}: {resp.status_code} - {len(resp.text)} bytes")
    except:
        print(f"{endpoint}: failed")