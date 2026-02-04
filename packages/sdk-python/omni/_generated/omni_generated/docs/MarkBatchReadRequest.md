# MarkBatchReadRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance ID | 
**chat_id** | **str** | Chat ID containing the messages | 
**message_ids** | **List[str]** | Message IDs to mark as read | 

## Example

```python
from omni_generated.models.mark_batch_read_request import MarkBatchReadRequest

# TODO update the JSON string below
json = "{}"
# create an instance of MarkBatchReadRequest from a JSON string
mark_batch_read_request_instance = MarkBatchReadRequest.from_json(json)
# print the JSON string representation of the object
print(MarkBatchReadRequest.to_json())

# convert the object into a dict
mark_batch_read_request_dict = mark_batch_read_request_instance.to_dict()
# create an instance of MarkBatchReadRequest from a dict
mark_batch_read_request_from_dict = MarkBatchReadRequest.from_dict(mark_batch_read_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


