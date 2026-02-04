# DeleteInstance200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**success** | **bool** | Operation succeeded | 
**message** | **str** | Optional success message | [optional] 

## Example

```python
from omni_generated.models.delete_instance200_response import DeleteInstance200Response

# TODO update the JSON string below
json = "{}"
# create an instance of DeleteInstance200Response from a JSON string
delete_instance200_response_instance = DeleteInstance200Response.from_json(json)
# print the JSON string representation of the object
print(DeleteInstance200Response.to_json())

# convert the object into a dict
delete_instance200_response_dict = delete_instance200_response_instance.to_dict()
# create an instance of DeleteInstance200Response from a dict
delete_instance200_response_from_dict = DeleteInstance200Response.from_dict(delete_instance200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


