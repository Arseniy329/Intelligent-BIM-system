import requests

url = "http://127.0.0.1:8000/api/v1/placement/compute"
token = "eyJhbGciOiJFUzI1NiIsImtpZCI6ImViMmZjZjY3LWU4ZGUtNGNiZi04MTNjLTlkYTkxMjk1MzRkZSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3Fna3hlcnhpeXpwYmVjemtwYnBqLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJhZjYwNDU2Yi1iODhiLTRhZDctODVjYS00Zjg0NGMxZjU3NjEiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzkzMjEzMzE3LCJpYXQiOjE3OTMyMDk3MTcsImVtYWlsIjoiZ3JpZGtvZGFzaGFAZ21haWwuY29tIiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsInByb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6eyJlbWFpbCI6ImdyaWRrb2Rhc2hhQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJwaG9uZV92ZXJpZmllZCI6ZmFsc2UsInN1YiI6ImFmNjA0NTZiLWI4OGItNGFkNy04NWNhLTRmODQ0YzFmNTc2MSJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6InBhc3N3b3JkIiwidGltZXN0YW1wIjoxNzkzMjA5NzE3fV0sInNlc3Npb25faWQiOiJjMWFjMWRhMi01NGI3LTQ2MDEtODFhZC0yNmMxMzMyNjA5OWQiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.oltF10iar5WZSTFYDFSAfY87Q2LtxoESa2ii6Gzx3F9SP2_rgYP0kr1zHaWRedTktWYnAWRT-ldngbfmn0bmcg"

headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
payload = {
    "rule_id": "265df400-8e54-45bb-a271-8b1af607c9dc",
    "drawing_id": "3bf1d77d-c591-4594-9398-0617b45c442c",
    "polygon": [[0, 0], [10, 0], [10, 8], [0, 8]]
}

response = requests.post(url, headers=headers, json=payload)
data = response.json()
print("Відповідь сервера:", data)

devices = data["devices"]
print("Кількість точок:", len(devices))

# Перевірки US9
assert len(devices) > 0, "Помилка: список порожній!"
assert all(d["x"] >= 1.0 for d in devices), "Помилка координат X!"
assert all(d["y"] >= 1.0 for d in devices), "Помилка координат Y!"

print("Усі перевірки US9 пройдено успішно!")
