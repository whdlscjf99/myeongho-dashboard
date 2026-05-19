"""
Regex patterns for parsing comcigan data
Original from comcigan library
"""
import re

routereg = re.compile(r"'\*\*(.*?)\*\*'")
prefixreg = re.compile(r"_wj\['\*(.*?)'\]")
orgdatareg = re.compile(r"학교검색\(.*?\)")
daydatareg = re.compile(r"일일자료\(.*?\)")
thnamereg = re.compile(r"성명0\(.*?\)")
sbnamereg = re.compile(r"자료83\(.*?\)")

def regsearch(regex, string):
    return regex.search(string).group(0)

def extractint(string):
    return int(re.sub(r"[^0-9]", "", string))
