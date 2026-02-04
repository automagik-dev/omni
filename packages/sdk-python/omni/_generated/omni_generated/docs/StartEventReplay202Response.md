# StartEventReplay202Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**ListReplaySessions200ResponseItemsInner**](ListReplaySessions200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.start_event_replay202_response import StartEventReplay202Response

# TODO update the JSON string below
json = "{}"
# create an instance of StartEventReplay202Response from a JSON string
start_event_replay202_response_instance = StartEventReplay202Response.from_json(json)
# print the JSON string representation of the object
print(StartEventReplay202Response.to_json())

# convert the object into a dict
start_event_replay202_response_dict = start_event_replay202_response_instance.to_dict()
# create an instance of StartEventReplay202Response from a dict
start_event_replay202_response_from_dict = StartEventReplay202Response.from_dict(start_event_replay202_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


