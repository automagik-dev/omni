# LogEntry


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**time** | **float** | Timestamp (ms) | 
**level** | **str** | Log level | 
**module** | **str** | Module name | 
**msg** | **str** | Log message | 

## Example

```python
from omni_generated.models.log_entry import LogEntry

# TODO update the JSON string below
json = "{}"
# create an instance of LogEntry from a JSON string
log_entry_instance = LogEntry.from_json(json)
# print the JSON string representation of the object
print(LogEntry.to_json())

# convert the object into a dict
log_entry_dict = log_entry_instance.to_dict()
# create an instance of LogEntry from a dict
log_entry_from_dict = LogEntry.from_dict(log_entry_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


