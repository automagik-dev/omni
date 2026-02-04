# DeletePayloadsRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**reason** | **str** | Deletion reason | 

## Example

```python
from omni_generated.models.delete_payloads_request import DeletePayloadsRequest

# TODO update the JSON string below
json = "{}"
# create an instance of DeletePayloadsRequest from a JSON string
delete_payloads_request_instance = DeletePayloadsRequest.from_json(json)
# print the JSON string representation of the object
print(DeletePayloadsRequest.to_json())

# convert the object into a dict
delete_payloads_request_dict = delete_payloads_request_instance.to_dict()
# create an instance of DeletePayloadsRequest from a dict
delete_payloads_request_from_dict = DeletePayloadsRequest.from_dict(delete_payloads_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


