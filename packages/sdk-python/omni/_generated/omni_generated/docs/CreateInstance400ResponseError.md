# CreateInstance400ResponseError


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**code** | **str** | Error code | 
**message** | **str** | Human-readable error message | 
**details** | **object** | Additional error details | [optional] 

## Example

```python
from omni_generated.models.create_instance400_response_error import CreateInstance400ResponseError

# TODO update the JSON string below
json = "{}"
# create an instance of CreateInstance400ResponseError from a JSON string
create_instance400_response_error_instance = CreateInstance400ResponseError.from_json(json)
# print the JSON string representation of the object
print(CreateInstance400ResponseError.to_json())

# convert the object into a dict
create_instance400_response_error_dict = create_instance400_response_error_instance.to_dict()
# create an instance of CreateInstance400ResponseError from a dict
create_instance400_response_error_from_dict = CreateInstance400ResponseError.from_dict(create_instance400_response_error_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


