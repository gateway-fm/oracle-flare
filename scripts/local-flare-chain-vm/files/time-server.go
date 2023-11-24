package main

import (
    "fmt"
    "time"
    "strings"
    "net/http"
    "os/exec"
    "regexp"
)

func changeTime(w http.ResponseWriter, req *http.Request) {
    tm := strings.TrimPrefix(req.URL.Path, "/")
    fmt.Println(tm);
    match, _ := regexp.MatchString("^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$", tm)
    dt := time.Now()
    fmt.Println(match)
    if !match {
        fmt.Fprintf(w, "{\nchanged: %s,\noldTime: \"%s\",\nnewTime: \"%s\"\n}", "false", dt.String(), dt.String())
        return
    }    
    args := []string{"set-time", tm}
    err := exec.Command("timedatectl", args...).Run() 
    if err != nil {
        fmt.Println(err)
        fmt.Fprintf(w, "{\nchanged: %s,\noldTime: \"%s\",\nnewTime: \"%s\"\n}", "false", dt.String(), dt.String())   
        return;
    }
    dt2 := time.Now();
    fmt.Fprintf(w, "{\nchanged: %s,\noldTime: \"%s\",\nnewTime: \"%s\"\n}", "true", dt.String(), dt2.String())   
}

func main() {
    http.HandleFunc("/", changeTime)
    args := []string{"set-ntp", "false"}
    err := exec.Command("timedatectl", args...).Run() 
    if err != nil {
        fmt.Println(err)
        return;
    }

    fmt.Printf("Starting server for testing HTTP POST...\n")
    http.ListenAndServe(":8080", nil);
}

// Example call: 
// curl http://localhost:8080/2021-03-30%2005:25:55