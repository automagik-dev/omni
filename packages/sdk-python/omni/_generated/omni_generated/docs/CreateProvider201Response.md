# CreateProvider201Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**ListProviders200ResponseItemsInner**](ListProviders200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.create_provider201_response import CreateProvider201Response

# TODO update the JSON string below
json = "{}"
# create an instance of CreateProvider201Response from a JSON string
create_provider201_response_instance = CreateProvider201Response.from_json(json)
# print the JSON string representation of the object
print(CreateProvider201Response.to_json())

# convert the object into a dict
create_provider201_response_dict = create_provider201_response_instance.to_dict()
# create an instance of CreateProvider201Response from a dict
create_provider201_response_from_dict = CreateProvider201Response.from_dict(create_provider201_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


