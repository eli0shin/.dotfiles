#!/bin/bash

# Create a directory for logs if it doesn't exist
mkdir -p ~/.config/nvim/startup_logs

# Get current date and time for log file name
timestamp=$(date +%Y%m%d_%H%M%S)
logfile=~/.config/nvim/startup_logs/startup_${timestamp}.log

# Number of times to run the test
runs=5

echo "Measuring Neovim startup time (${runs} runs)"
echo "Results will be saved to ${logfile}"
echo

# Initialize the log file
echo "Neovim Startup Time Measurement" > "$logfile"
echo "Date: $(date)" >> "$logfile"
echo "Number of runs: ${runs}" >> "$logfile"
echo "----------------------------------------" >> "$logfile"

total_time=0

# Run the test multiple times
for i in $(seq 1 $runs); do
    echo -n "Run $i: "
    
    # Measure time to start Neovim, populate UI, and exit
    start_time=$(date +%s.%N)
    nvim --headless -c 'quit'
    end_time=$(date +%s.%N)
    
    # Calculate the duration
    duration=$(echo "$end_time - $start_time" | bc)
    formatted_duration=$(printf "%.4f" $duration)
    
    echo "${formatted_duration}s"
    echo "Run $i: ${formatted_duration}s" >> "$logfile"
    
    total_time=$(echo "$total_time + $duration" | bc)
done

# Calculate the average
average=$(echo "scale=4; $total_time / $runs" | bc)

echo "----------------------------------------" >> "$logfile"
echo "Average startup time: ${average}s" >> "$logfile"
echo
echo "Average startup time: ${average}s"
echo "Results saved to ${logfile}"

# Generate a more detailed startup log for analysis
detailed_log=~/.config/nvim/startup_logs/detailed_${timestamp}.log
echo "Generating detailed startup log at ${detailed_log}"
nvim --startuptime "$detailed_log" -c 'quit'
echo "Detailed log saved to ${detailed_log}"