# DeleteEventPayloadsRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**reason** | **str** | Deletion reason | 

## Example

```python
from omni_generated.models.delete_event_payloads_request import DeleteEventPayloadsRequest

# TODO update the JSON string below
json = "{}"
# create an instance of DeleteEventPayloadsRequest from a JSON string
delete_event_payloads_request_instance = DeleteEventPayloadsRequest.from_json(json)
# print the JSON string representation of the object
print(DeleteEventPayloadsRequest.to_json())

# convert the object into a dict
delete_event_payloads_request_dict = delete_event_payloads_request_instance.to_dict()
# create an instance of DeleteEventPayloadsRequest from a dict
delete_event_payloads_request_from_dict = DeleteEventPayloadsRequest.from_dict(delete_event_payloads_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


