# TriggerEventRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**event_type** | **str** | Event type (must start with custom.) | 
**payload** | **Dict[str, Optional[object]]** | Event payload | 
**correlation_id** | **str** | Correlation ID | [optional] 
**instance_id** | **UUID** | Instance ID for context | [optional] 

## Example

```python
from omni_generated.models.trigger_event_request import TriggerEventRequest

# TODO update the JSON string below
json = "{}"
# create an instance of TriggerEventRequest from a JSON string
trigger_event_request_instance = TriggerEventRequest.from_json(json)
# print the JSON string representation of the object
print(TriggerEventRequest.to_json())

# convert the object into a dict
trigger_event_request_dict = trigger_event_request_instance.to_dict()
# create an instance of TriggerEventRequest from a dict
trigger_event_request_from_dict = TriggerEventRequest.from_dict(trigger_event_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


