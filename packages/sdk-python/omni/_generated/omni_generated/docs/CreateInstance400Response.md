# CreateInstance400Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**error** | [**CreateInstance400ResponseError**](CreateInstance400ResponseError.md) |  | 

## Example

```python
from omni_generated.models.create_instance400_response import CreateInstance400Response

# TODO update the JSON string below
json = "{}"
# create an instance of CreateInstance400Response from a JSON string
create_instance400_response_instance = CreateInstance400Response.from_json(json)
# print the JSON string representation of the object
print(CreateInstance400Response.to_json())

# convert the object into a dict
create_instance400_response_dict = create_instance400_response_instance.to_dict()
# create an instance of CreateInstance400Response from a dict
create_instance400_response_from_dict = CreateInstance400Response.from_dict(create_instance400_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


